import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import pg from 'pg';
import {
  BillingService,
  FakeBillingProvider,
  PostgresBillingRepository,
} from '../../packages/billing/dist/index.js';
import {
  CostGuardError,
  CostGuardService,
  PostgresUsageCostRepository,
  UsageCostService,
} from '../../packages/cost-guard/dist/index.js';
import {
  assertLocalSupabaseTarget,
  assertNativeSupabaseContract,
  cleanupGreenHiveFixtures,
} from '../../scripts/lib/local-supabase-guard.mjs';
import {
  stagingDatabaseConfigurationFromEnvironment,
  SUPABASE_STAGING_TARGET,
} from '../../scripts/lib/staging-guard.mjs';
import { loadMigrationCatalog } from '../../scripts/lib/migration-catalog.mjs';
import {
  ADMIN_ID,
  ORGANIZATION_A_ID,
  REFERENCE_APP_ID,
  USER_A_ID,
} from './helpers/rls-matrix.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const databaseUrl = process.env.GREEN_HIVE_TEST_DATABASE_URL;
const confirmation = process.env.GREEN_HIVE_TEST_CONFIRM;
const target = process.env.GREEN_HIVE_TEST_TARGET;
const isStaging = target === SUPABASE_STAGING_TARGET;
const PROJECT_ID = '20000000-0000-4000-8000-000000000119';
const REFERENCE_PRICE_ID = '50000000-0000-4000-8000-000000000001';
const contextA = {
  userId: USER_A_ID,
  appCode: 'REFERENCE_APP',
  organizationId: ORGANIZATION_A_ID,
};

function claims(subject, appCode, platformRole = 'USER') {
  return JSON.stringify({
    sub: subject,
    app_metadata: { app_code: appCode, platform_role: platformRole },
  });
}

async function setContext(client, subject, appCode, organizationId, platformRole = 'USER') {
  await client.query(
    `SELECT
       set_config('request.jwt.claims', $1, false),
       set_config('request.green_hive.organization_id', $2, false)`,
    [claims(subject, appCode, platformRole), organizationId ?? ''],
  );
}

function executor(client) {
  return {
    query(sql, parameters = []) {
      return client.query(sql, parameters);
    },
  };
}

function hasCode(code) {
  return (error) => error instanceof CostGuardError && error.code === code;
}

test(
  'GH-0402 atomic Cost Guard on native Supabase',
  { skip: !databaseUrl || !confirmation ? 'local Supabase gate not configured' : false },
  async (testContext) => {
    if (isStaging) {
      const staging = stagingDatabaseConfigurationFromEnvironment();
      assert.equal(staging.databaseUrl.toString(), new URL(databaseUrl).toString());
      assert.equal(process.env.GREEN_HIVE_TEST_PREPARED, 'SUPABASE_STAGING_BASELINE_READY');
    } else {
      assertLocalSupabaseTarget({ databaseUrl, target, confirmation });
    }

    const client = new pg.Client({ connectionString: databaseUrl });
    const concurrentA = new pg.Client({ connectionString: databaseUrl });
    const concurrentB = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    let concurrentConnected = false;

    try {
      await assertNativeSupabaseContract(client);
      const catalog = await loadMigrationCatalog(repositoryRoot);
      const baseline = await client.query(
        `SELECT
           (SELECT count(*)::integer FROM hive.schema_migrations) AS migrations,
           to_regclass('hive.cost_guard_decisions') IS NOT NULL AS decisions_ready,
           to_regclass('hive.cost_guard_reservations') IS NOT NULL AS reservations_ready,
           to_regprocedure(
             'hive.reserve_project_cost(uuid,uuid,text,text,numeric,text,jsonb)'
           ) IS NOT NULL AS reserve_ready,
           to_regprocedure(
             'hive.consume_cost_reservation(uuid,numeric,text,text,text,timestamp with time zone,jsonb)'
           ) IS NOT NULL AS consume_ready,
           to_regprocedure(
             'hive.release_cost_reservation(uuid,jsonb)'
           ) IS NOT NULL AS release_ready`,
      );
      assert.deepEqual(baseline.rows[0], {
        migrations: catalog.migrations.length,
        decisions_ready: true,
        reservations_ready: true,
        reserve_ready: true,
        consume_ready: true,
        release_ready: true,
      });

      await cleanupGreenHiveFixtures(client);
      await client.query(
        await readFile(
          path.join(repositoryRoot, 'database', 'tests', 'fixtures', '0001_rls_identities.sql'),
          'utf8',
        ),
      );
      await client.query('SET ROLE authenticated');
      await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
      await client.query(
        `INSERT INTO hive.projects (id, organization_id, app_id, owner_user_id, name)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Native Atomic Cost Guard')`,
        [PROJECT_ID, ORGANIZATION_A_ID, REFERENCE_APP_ID, USER_A_ID],
      );

      const database = executor(client);
      const repository = new PostgresUsageCostRepository(database);
      const usageCost = new UsageCostService(repository);
      const costGuard = new CostGuardService(repository);
      const billing = new BillingService(
        new PostgresBillingRepository(database),
        new FakeBillingProvider({ paymentOutcome: 'SUCCESS' }),
      );
      const purchase = await billing.createPurchase(contextA, {
        projectId: PROJECT_ID,
        productCode: 'REFERENCE_APP_SANDBOX',
        priceId: REFERENCE_PRICE_ID,
        idempotencyKey: 'native-cost-guard-entitlement-0001',
      });

      await client.query('RESET ROLE');
      const budget = await usageCost.configureBudget(contextA, {
        projectId: PROJECT_ID,
        budgetType: 'TOTAL_COST',
        measurementKind: 'COST',
        unitCode: 'BRL',
        ceilingAmount: '10',
        cycleId: 'native-cost-guard-cycle',
        idempotencyKey: 'native-cost-guard-budget-0001',
      });

      await testContext.test('entitlement is checked before a cost reservation', async () => {
        const denied = await costGuard.reserve(contextA, {
          projectId: PROJECT_ID,
          budgetId: budget.id,
          operationId: 'native-cost-guard-no-entitlement-001',
          capabilityCode: 'REFERENCE_APP_RUN_JOB',
          estimatedAmount: '1',
          currency: 'BRL',
        });
        assert.equal(denied.decision.outcome, 'DENY_ENTITLEMENT');
        assert.equal(denied.reservation, null);
        await billing.processPayment(contextA, purchase.id);
      });

      await testContext.test('separate connections cannot concurrently overspend one budget', async () => {
        await concurrentA.connect();
        await concurrentB.connect();
        concurrentConnected = true;
        await setContext(concurrentA, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
        await setContext(concurrentB, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
        const guardA = new CostGuardService(new PostgresUsageCostRepository(executor(concurrentA)));
        const guardB = new CostGuardService(new PostgresUsageCostRepository(executor(concurrentB)));
        const inputs = [
          {
            projectId: PROJECT_ID,
            budgetId: budget.id,
            operationId: 'native-cost-guard-concurrent-a-001',
            capabilityCode: 'REFERENCE_APP_RUN_JOB',
            estimatedAmount: '6',
            currency: 'BRL',
          },
          {
            projectId: PROJECT_ID,
            budgetId: budget.id,
            operationId: 'native-cost-guard-concurrent-b-001',
            capabilityCode: 'REFERENCE_APP_RUN_JOB',
            estimatedAmount: '6',
            currency: 'BRL',
          },
        ];
        const results = await Promise.all([
          guardA.reserve(contextA, inputs[0]),
          guardB.reserve(contextA, inputs[1]),
        ]);
        assert.deepEqual(
          results.map((result) => result.decision.outcome).sort(),
          ['ALLOW', 'DENY_BUDGET'],
        );
        const allowed = results.find((result) => result.decision.outcome === 'ALLOW');
        assert.equal((await costGuard.reserve(
          contextA,
          inputs.find((input) => input.operationId === allowed.decision.operationId),
        )).decision.id, allowed.decision.id);
        await assert.rejects(
          costGuard.reserve(contextA, {
            ...inputs.find((input) => input.operationId === allowed.decision.operationId),
            estimatedAmount: '5',
          }),
          hasCode('COST_GUARD_IDEMPOTENCY_CONFLICT'),
        );
        await costGuard.release(contextA, { reservationId: allowed.reservation.id });
      });

      await testContext.test('consume reconciles one cost event and release is terminal', async () => {
        const reserved = await costGuard.reserve(contextA, {
          projectId: PROJECT_ID,
          budgetId: budget.id,
          operationId: 'native-cost-guard-consume-001',
          capabilityCode: 'REFERENCE_APP_RUN_JOB',
          estimatedAmount: '8',
          currency: 'BRL',
        });
        const consumeInput = {
          reservationId: reserved.reservation.id,
          actualAmount: '7',
          providerCode: 'SANDBOX',
          serviceCode: 'REFERENCE_APP',
          modelCode: 'sandbox-model-v1',
        };
        assert.equal((await costGuard.consume(contextA, consumeInput)).status, 'CONSUMED');
        assert.equal((await costGuard.consume(contextA, consumeInput)).id, reserved.reservation.id);
        await assert.rejects(
          costGuard.release(contextA, { reservationId: reserved.reservation.id }),
          hasCode('COST_GUARD_INVALID_TRANSITION'),
        );
        const accounting = await client.query(
          `SELECT
             budget.consumed_amount::text,
             budget.reserved_amount::text,
             (SELECT count(*)::integer FROM hive.cost_events AS event
               WHERE event.budget_id = budget.id
                 AND event.operation_id = 'native-cost-guard-consume-001') AS cost_events
           FROM hive.usage_budgets AS budget
           WHERE budget.id = $1::uuid`,
          [budget.id],
        );
        assert.deepEqual(accounting.rows[0], {
          consumed_amount: '7.00000000',
          reserved_amount: '0.00000000',
          cost_events: 1,
        });
      });

      await testContext.test('authenticated clients and platform admins remain read-only', async () => {
        await client.query('SET ROLE authenticated');
        await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
        assert.ok((await client.query(
          'SELECT id, decision FROM hive.cost_guard_decisions WHERE project_id = $1::uuid',
          [PROJECT_ID],
        )).rows.length >= 4);
        await assert.rejects(
          client.query('SELECT consumed_amount FROM hive.cost_guard_reservations LIMIT 1'),
          /permission denied|privilege/i,
        );
        await assert.rejects(
          client.query(
            `SELECT hive.reserve_project_cost(
              $1::uuid, $2::uuid, 'native-forged-browser',
              'REFERENCE_APP_RUN_JOB', 1, 'BRL', '{}'::jsonb
            )`,
            [PROJECT_ID, budget.id],
          ),
          /permission denied|privilege/i,
        );
        await setContext(client, ADMIN_ID, 'REFERENCE_APP', null, 'PLATFORM_ADMIN');
        assert.ok((await client.query('SELECT id, status FROM hive.cost_guard_reservations')).rows.length >= 2);
        await assert.rejects(
          costGuard.reserve(
            { ...contextA, platformRole: 'PLATFORM_ADMIN' },
            {
              projectId: PROJECT_ID,
              budgetId: budget.id,
              operationId: 'native-cost-guard-admin-001',
              capabilityCode: 'REFERENCE_APP_RUN_JOB',
              estimatedAmount: '1',
              currency: 'BRL',
            },
          ),
          hasCode('COST_GUARD_ACCESS_DENIED'),
        );
        await client.query('RESET ROLE');
        const audit = await client.query(
          `SELECT
             (SELECT count(*)::integer FROM hive.cost_guard_decisions
               WHERE project_id = $1::uuid) AS decisions,
             (SELECT count(*)::integer FROM audit.events
               WHERE project_id = $1::uuid AND event_code = 'COST_GUARD_DECIDED') AS audit_events,
             (SELECT count(*)::integer FROM audit.events
               WHERE project_id = $1::uuid AND event_code = 'COST_GUARD_DECIDED'
                 AND metadata::text ~* '(amount|provider|model|idempotency|operation)') AS leaked`,
          [PROJECT_ID],
        );
        assert.equal(audit.rows[0].decisions, audit.rows[0].audit_events);
        assert.equal(audit.rows[0].leaked, 0);
      });
    } finally {
      if (concurrentConnected) {
        await Promise.allSettled([concurrentA.end(), concurrentB.end()]);
      }
      await cleanupGreenHiveFixtures(client).catch(() => undefined);
      await client.end();
    }
  },
);
