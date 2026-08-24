import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import pg from 'pg';
import {
  PostgresUsageCostRepository,
  UsageCostError,
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
  ORGANIZATION_B_ID,
  REFERENCE_APP_ID,
  USER_A_ID,
  USER_B_ID,
} from './helpers/rls-matrix.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const databaseUrl = process.env.GREEN_HIVE_TEST_DATABASE_URL;
const confirmation = process.env.GREEN_HIVE_TEST_CONFIRM;
const target = process.env.GREEN_HIVE_TEST_TARGET;
const isStaging = target === SUPABASE_STAGING_TARGET;
const PROJECT_ID = '20000000-0000-4000-8000-000000000118';
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

function hasCode(code) {
  return (error) => error instanceof UsageCostError && error.code === code;
}

test(
  'GH-0401 usage and cost foundation on native Supabase',
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
    await client.connect();
    const service = new UsageCostService(
      new PostgresUsageCostRepository({
        query(sql, parameters = []) {
          return client.query(sql, parameters);
        },
      }),
    );
    let usageBudget;
    let costBudget;
    let usageEvent;

    try {
      await assertNativeSupabaseContract(client);
      const catalog = await loadMigrationCatalog(repositoryRoot);
      const baseline = await client.query(
        `SELECT
           (SELECT count(*)::integer FROM hive.schema_migrations) AS migrations,
           to_regclass('hive.usage_budgets') IS NOT NULL AS budgets_ready,
           to_regclass('hive.usage_events') IS NOT NULL AS usage_ready,
           to_regclass('hive.cost_events') IS NOT NULL AS costs_ready,
           to_regprocedure(
             'hive.configure_usage_budget(uuid,text,text,text,numeric,text,timestamp with time zone,timestamp with time zone,text,jsonb)'
           ) IS NOT NULL AS configure_ready`,
      );
      assert.deepEqual(baseline.rows[0], {
        migrations: catalog.migrations.length,
        budgets_ready: true,
        usage_ready: true,
        costs_ready: true,
        configure_ready: true,
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
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Native Usage Cost Project')`,
        [PROJECT_ID, ORGANIZATION_A_ID, REFERENCE_APP_ID, USER_A_ID],
      );

      await testContext.test('writes are server-only and exact-decimal budgets are idempotent', async () => {
        await assert.rejects(
          client.query(
            `SELECT hive.configure_usage_budget(
              $1::uuid, 'AI', 'USAGE', 'TOKENS', 1000, 'native-cycle', NULL, NULL,
              'native-budget-usage-0001', '{}'::jsonb
            )`,
            [PROJECT_ID],
          ),
          /permission denied|privilege/i,
        );
        await client.query('RESET ROLE');
        await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
        const input = {
          projectId: PROJECT_ID,
          budgetType: 'AI',
          measurementKind: 'USAGE',
          unitCode: 'TOKENS',
          ceilingAmount: '1000',
          cycleId: 'native-cycle',
          idempotencyKey: 'native-budget-usage-0001',
        };
        usageBudget = await service.configureBudget(contextA, input);
        assert.equal((await service.configureBudget(contextA, input)).id, usageBudget.id);
        assert.equal(usageBudget.ceilingAmount, '1000.00000000');
        assert.equal(usageBudget.consumedAmount, '0.00000000');
        assert.equal(usageBudget.reservedAmount, '0.00000000');
        await assert.rejects(
          service.configureBudget(contextA, { ...input, ceilingAmount: '999' }),
          hasCode('USAGE_COST_IDEMPOTENCY_CONFLICT'),
        );
        costBudget = await service.configureBudget(contextA, {
          projectId: PROJECT_ID,
          budgetType: 'TOTAL_COST',
          measurementKind: 'COST',
          unitCode: 'BRL',
          ceilingAmount: '50',
          cycleId: 'native-cycle',
          idempotencyKey: 'native-budget-cost-0001',
        });
      });

      await testContext.test('usage and monetary cost remain separate and replay-safe', async () => {
        const usageInput = {
          projectId: PROJECT_ID,
          budgetId: usageBudget.id,
          operationId: 'native-usage-operation-001',
          idempotencyKey: 'native-usage-event-0001',
          eventKind: 'DEBIT',
          usageCode: 'AI_INPUT_TOKENS',
          quantity: '12.5',
          unitCode: 'TOKENS',
          cycleId: 'native-cycle',
          providerCode: 'SANDBOX',
          serviceCode: 'REFERENCE_APP',
        };
        usageEvent = await service.recordUsage(contextA, usageInput);
        assert.equal((await service.recordUsage(contextA, usageInput)).id, usageEvent.id);
        await service.recordUsage(contextA, {
          ...usageInput,
          operationId: 'native-usage-credit-001',
          idempotencyKey: 'native-usage-credit-0001',
          eventKind: 'CREDIT',
          quantity: '2.5',
        });
        const cost = await service.recordCost(contextA, {
          projectId: PROJECT_ID,
          budgetId: costBudget.id,
          operationId: 'native-cost-operation-001',
          idempotencyKey: 'native-cost-event-0001',
          eventKind: 'DEBIT',
          amount: '0.12345678',
          currency: 'BRL',
          providerCode: 'SANDBOX',
          serviceCode: 'REFERENCE_APP',
          modelCode: 'sandbox-model-v1',
          cycleId: 'native-cycle',
        });
        assert.equal(cost.amount, '0.12345678');
        assert.deepEqual(await service.summarizeUsage(contextA, PROJECT_ID), [
          {
            usageCode: 'AI_INPUT_TOKENS',
            unitCode: 'TOKENS',
            cycleId: 'native-cycle',
            debitedQuantity: '12.50000000',
            creditedQuantity: '2.50000000',
            netQuantity: '10.00000000',
          },
        ]);
      });

      await testContext.test('RLS blocks cross-tenant access and hides internal costs from owners', async () => {
        await setContext(client, USER_B_ID, 'REFERENCE_APP', ORGANIZATION_B_ID);
        assert.deepEqual(
          await service.listBudgets(
            { userId: USER_B_ID, appCode: 'REFERENCE_APP', organizationId: ORGANIZATION_B_ID },
            PROJECT_ID,
          ),
          [],
        );
        await assert.rejects(
          service.recordUsage(
            { userId: USER_B_ID, appCode: 'REFERENCE_APP', organizationId: ORGANIZATION_B_ID },
            { ...usageInputForCrossScope(usageBudget.id), idempotencyKey: 'native-cross-user-0001' },
          ),
          hasCode('USAGE_COST_ACCESS_DENIED'),
        );
        await setContext(client, USER_A_ID, 'OTHER_TEST_APP', ORGANIZATION_A_ID);
        assert.deepEqual(
          await service.listUsageEvents({ ...contextA, appCode: 'OTHER_TEST_APP' }, PROJECT_ID),
          [],
        );
        await client.query('SET ROLE authenticated');
        await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
        assert.equal((await client.query('SELECT id FROM hive.usage_events')).rows.length, 2);
        assert.equal((await client.query('SELECT id FROM hive.cost_events')).rows.length, 0);
        await assert.rejects(
          client.query('DELETE FROM hive.usage_events WHERE id = $1::uuid', [usageEvent.id]),
          /permission denied|privilege/i,
        );
      });

      await testContext.test('platform admin reads evidence but cannot write', async () => {
        await setContext(client, ADMIN_ID, 'REFERENCE_APP', null, 'PLATFORM_ADMIN');
        assert.equal((await client.query('SELECT id FROM hive.usage_budgets')).rows.length, 2);
        assert.equal((await client.query('SELECT id FROM hive.usage_events')).rows.length, 2);
        assert.equal((await client.query('SELECT id FROM hive.cost_events')).rows.length, 1);
        await assert.rejects(
          service.listBudgets({ ...contextA, platformRole: 'PLATFORM_ADMIN' }, PROJECT_ID),
          hasCode('USAGE_COST_ACCESS_DENIED'),
        );
        await assert.rejects(
          client.query('UPDATE hive.usage_budgets SET consumed_amount = 1'),
          /permission denied|privilege/i,
        );
      });

      await client.query('RESET ROLE');
      const evidence = await client.query(
        `SELECT
           (SELECT count(*)::integer FROM hive.usage_budgets WHERE project_id = $1::uuid) AS budgets,
           (SELECT count(*)::integer FROM hive.usage_events WHERE project_id = $1::uuid) AS usage_events,
           (SELECT count(*)::integer FROM hive.cost_events WHERE project_id = $1::uuid) AS cost_events,
           (SELECT count(*)::integer FROM audit.events
             WHERE project_id = $1::uuid
               AND event_code = 'USAGE_BUDGET_CONFIGURED') AS audit_events`,
        [PROJECT_ID],
      );
      assert.deepEqual(evidence.rows[0], {
        budgets: 2,
        usage_events: 2,
        cost_events: 1,
        audit_events: 2,
      });
    } finally {
      await cleanupGreenHiveFixtures(client).catch(() => undefined);
      await client.end();
    }
  },
);

function usageInputForCrossScope(budgetId) {
  return {
    projectId: PROJECT_ID,
    budgetId,
    operationId: 'native-cross-user-001',
    eventKind: 'DEBIT',
    usageCode: 'AI_INPUT_TOKENS',
    quantity: '1',
    unitCode: 'TOKENS',
  };
}
