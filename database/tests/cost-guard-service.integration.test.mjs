import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
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
import { loadMigrationCatalog } from '../../scripts/lib/migration-catalog.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const USER_A_ID = '10000000-0000-4000-8000-000000000001';
const USER_B_ID = '10000000-0000-4000-8000-000000000002';
const ADMIN_ID = '10000000-0000-4000-8000-000000000003';
const ORGANIZATION_A_ID = '30000000-0000-4000-8000-000000000001';
const ORGANIZATION_B_ID = '30000000-0000-4000-8000-000000000002';
const REFERENCE_APP_ID = '00000000-0000-4000-8000-000000000001';
const REFERENCE_PRICE_ID = '50000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000118';

const contextA = {
  userId: USER_A_ID,
  appCode: 'REFERENCE_APP',
  organizationId: ORGANIZATION_A_ID,
};

const authShim = `
  CREATE SCHEMA auth;
  CREATE SCHEMA storage;
  CREATE TABLE storage.buckets (
    id text PRIMARY KEY,
    name text NOT NULL,
    public boolean NOT NULL DEFAULT false
  );
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION auth.jwt()
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog
  AS $$
  DECLARE raw_claims text;
  BEGIN
    raw_claims := current_setting('request.jwt.claims', true);
    IF raw_claims IS NULL OR btrim(raw_claims) = '' THEN RETURN '{}'::jsonb; END IF;
    BEGIN RETURN raw_claims::jsonb;
    EXCEPTION WHEN invalid_text_representation THEN RETURN '{}'::jsonb;
    END;
  END;
  $$;
  CREATE FUNCTION auth.uid()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SET search_path = ''
  AS $$ SELECT nullif(auth.jwt() ->> 'sub', '')::uuid; $$;
  CREATE ROLE authenticated
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  GRANT USAGE ON SCHEMA auth TO authenticated;
  GRANT EXECUTE ON FUNCTION auth.jwt() TO authenticated;
  GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
`;

async function applyMigrations(database) {
  const catalog = await loadMigrationCatalog(repositoryRoot);
  for (const migration of catalog.migrations) {
    await database.exec(`BEGIN;\n${migration.sql}\nCOMMIT;`);
    await database.query(
      `INSERT INTO hive.schema_migrations
         (version, name, checksum_sha256, rollback_strategy, execution_ms)
       VALUES ($1, $2, $3, $4, 0)`,
      [migration.version, migration.file, migration.sha256, migration.rollbackStrategy],
    );
  }
}

async function applySeedsAndFixtures(database) {
  const seedsDirectory = path.join(repositoryRoot, 'database', 'seeds');
  for (const file of (await readdir(seedsDirectory)).filter((name) => name.endsWith('.sql')).sort()) {
    await database.exec(await readFile(path.join(seedsDirectory, file), 'utf8'));
  }
  await database.exec(
    await readFile(
      path.join(repositoryRoot, 'database', 'tests', 'fixtures', '0001_rls_identities.sql'),
      'utf8',
    ),
  );
}

async function setContext(database, userId, appCode, organizationId, platformRole = 'USER') {
  await database.query(
    `SELECT
       set_config('request.jwt.claims', $1, false),
       set_config('request.green_hive.organization_id', $2, false)`,
    [
      JSON.stringify({
        sub: userId,
        app_metadata: { app_code: appCode, platform_role: platformRole },
      }),
      organizationId ?? '',
    ],
  );
}

function hasCostGuardCode(code) {
  return (error) => error instanceof CostGuardError && error.code === code;
}

test('GH-0402 reserves, consumes and releases cost atomically without concurrent overspend', async () => {
  const database = new PGlite({ extensions: { pgcrypto } });
  await database.waitReady;
  try {
    await database.exec(authShim);
    await applyMigrations(database);
    await applySeedsAndFixtures(database);
    await database.exec('SET ROLE authenticated;');
    await setContext(database, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    await database.query(
      `INSERT INTO hive.projects (id, organization_id, app_id, owner_user_id, name)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Atomic Cost Guard Project')`,
      [PROJECT_ID, ORGANIZATION_A_ID, REFERENCE_APP_ID, USER_A_ID],
    );

    const executor = {
      query(sql, parameters = []) {
        return database.query(sql, parameters);
      },
    };
    const repository = new PostgresUsageCostRepository(executor);
    const usageCost = new UsageCostService(repository);
    const costGuard = new CostGuardService(repository);
    const billing = new BillingService(
      new PostgresBillingRepository(executor),
      new FakeBillingProvider({ paymentOutcome: 'SUCCESS' }),
    );

    const purchase = await billing.createPurchase(contextA, {
      projectId: PROJECT_ID,
      productCode: 'REFERENCE_APP_SANDBOX',
      priceId: REFERENCE_PRICE_ID,
      idempotencyKey: 'cost-guard-entitlement-0001',
    });

    await database.exec('RESET ROLE;');
    const budget = await usageCost.configureBudget(contextA, {
      projectId: PROJECT_ID,
      budgetType: 'TOTAL_COST',
      measurementKind: 'COST',
      unitCode: 'BRL',
      ceilingAmount: '10',
      cycleId: 'cycle-cost-guard-001',
      idempotencyKey: 'cost-guard-budget-0001',
    });

    const missingEntitlement = await costGuard.reserve(contextA, {
      projectId: PROJECT_ID,
      budgetId: budget.id,
      operationId: 'cost-guard-no-entitlement-001',
      capabilityCode: 'REFERENCE_APP_RUN_JOB',
      estimatedAmount: '2',
      currency: 'BRL',
    });
    assert.equal(missingEntitlement.decision.outcome, 'DENY_ENTITLEMENT');
    assert.equal(missingEntitlement.decision.reasonCode, 'ENTITLEMENT_REQUIRED');
    assert.equal(missingEntitlement.reservation, null);

    await billing.processPayment(contextA, purchase.id);

    const concurrentInputs = [
      {
        projectId: PROJECT_ID,
        budgetId: budget.id,
        operationId: 'cost-guard-concurrent-a-001',
        capabilityCode: 'REFERENCE_APP_RUN_JOB',
        estimatedAmount: '6',
        currency: 'BRL',
      },
      {
        projectId: PROJECT_ID,
        budgetId: budget.id,
        operationId: 'cost-guard-concurrent-b-001',
        capabilityCode: 'REFERENCE_APP_RUN_JOB',
        estimatedAmount: '6',
        currency: 'BRL',
      },
    ];
    const concurrent = await Promise.all(concurrentInputs.map((input) => costGuard.reserve(contextA, input)));
    const allowed = concurrent.find((result) => result.decision.outcome === 'ALLOW');
    const denied = concurrent.find((result) => result.decision.outcome === 'DENY_BUDGET');
    assert.ok(allowed?.reservation);
    assert.equal(denied?.decision.reasonCode, 'BUDGET_EXHAUSTED');
    assert.equal(denied?.reservation, null);

    const allowedInput = concurrentInputs.find(
      (input) => input.operationId === allowed.decision.operationId,
    );
    const allowedReplay = await costGuard.reserve(contextA, allowedInput);
    assert.equal(allowedReplay.decision.id, allowed.decision.id);
    assert.equal(allowedReplay.reservation.id, allowed.reservation.id);
    await assert.rejects(
      costGuard.reserve(contextA, { ...allowedInput, estimatedAmount: '5' }),
      hasCostGuardCode('COST_GUARD_IDEMPOTENCY_CONFLICT'),
    );

    let budgetState = await database.query(
      `SELECT consumed_amount::text, reserved_amount::text
       FROM hive.usage_budgets WHERE id = $1::uuid`,
      [budget.id],
    );
    assert.deepEqual(budgetState.rows[0], {
      consumed_amount: '0.00000000',
      reserved_amount: '6.00000000',
    });

    const released = await costGuard.release(contextA, {
      reservationId: allowed.reservation.id,
      metadata: { reason: 'provider_not_started' },
    });
    assert.equal(released.status, 'RELEASED');
    const releasedReplay = await costGuard.release(contextA, {
      reservationId: allowed.reservation.id,
      metadata: { reason: 'provider_not_started' },
    });
    assert.equal(releasedReplay.id, released.id);

    const consumable = await costGuard.reserve(contextA, {
      projectId: PROJECT_ID,
      budgetId: budget.id,
      operationId: 'cost-guard-consume-001',
      capabilityCode: 'REFERENCE_APP_RUN_JOB',
      estimatedAmount: '8',
      currency: 'BRL',
    });
    assert.equal(consumable.decision.outcome, 'ALLOW');
    const consumeInput = {
      reservationId: consumable.reservation.id,
      actualAmount: '7',
      providerCode: 'SANDBOX',
      serviceCode: 'REFERENCE_APP',
      modelCode: 'sandbox-model-v1',
      metadata: { cached: false },
    };
    const consumed = await costGuard.consume(contextA, consumeInput);
    assert.equal(consumed.status, 'CONSUMED');
    assert.equal(consumed.consumedAmount, '7.00000000');
    const consumedReplay = await costGuard.consume(contextA, consumeInput);
    assert.equal(consumedReplay.id, consumed.id);
    await assert.rejects(
      costGuard.consume(contextA, { ...consumeInput, actualAmount: '6' }),
      hasCostGuardCode('COST_GUARD_IDEMPOTENCY_CONFLICT'),
    );
    await assert.rejects(
      costGuard.release(contextA, { reservationId: consumed.id }),
      hasCostGuardCode('COST_GUARD_INVALID_TRANSITION'),
    );

    budgetState = await database.query(
      `SELECT consumed_amount::text, reserved_amount::text
       FROM hive.usage_budgets WHERE id = $1::uuid`,
      [budget.id],
    );
    assert.deepEqual(budgetState.rows[0], {
      consumed_amount: '7.00000000',
      reserved_amount: '0.00000000',
    });
    assert.equal(
      (await database.query(
        `SELECT id FROM hive.cost_events
         WHERE budget_id = $1::uuid AND operation_id = 'cost-guard-consume-001'`,
        [budget.id],
      )).rows.length,
      1,
    );

    const noCapacity = await costGuard.reserve(contextA, {
      projectId: PROJECT_ID,
      budgetId: budget.id,
      operationId: 'cost-guard-over-budget-001',
      capabilityCode: 'REFERENCE_APP_RUN_JOB',
      estimatedAmount: '4',
      currency: 'BRL',
    });
    assert.equal(noCapacity.decision.outcome, 'DENY_BUDGET');

    const bounded = await costGuard.reserve(contextA, {
      projectId: PROJECT_ID,
      budgetId: budget.id,
      operationId: 'cost-guard-bounded-001',
      capabilityCode: 'REFERENCE_APP_RUN_JOB',
      estimatedAmount: '3',
      currency: 'BRL',
    });
    await assert.rejects(
      costGuard.consume(contextA, {
        reservationId: bounded.reservation.id,
        actualAmount: '3.1',
        providerCode: 'SANDBOX',
        serviceCode: 'REFERENCE_APP',
      }),
      hasCostGuardCode('COST_GUARD_INVALID_TRANSITION'),
    );
    await costGuard.release(contextA, { reservationId: bounded.reservation.id });

    await setContext(database, USER_B_ID, 'REFERENCE_APP', ORGANIZATION_B_ID);
    await assert.rejects(
      costGuard.reserve(
        { userId: USER_B_ID, appCode: 'REFERENCE_APP', organizationId: ORGANIZATION_B_ID },
        {
          ...allowedInput,
          operationId: 'cost-guard-cross-user-001',
        },
      ),
      hasCostGuardCode('COST_GUARD_ACCESS_DENIED'),
    );

    await setContext(database, USER_A_ID, 'OTHER_TEST_APP', ORGANIZATION_A_ID);
    await assert.rejects(
      costGuard.reserve(
        { ...contextA, appCode: 'OTHER_TEST_APP' },
        {
          ...allowedInput,
          operationId: 'cost-guard-cross-app-001',
          capabilityCode: 'OTHER_TEST_APP_RUN_JOB',
        },
      ),
      hasCostGuardCode('COST_GUARD_ACCESS_DENIED'),
    );

    await database.exec('SET ROLE authenticated;');
    await setContext(database, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    assert.ok((await database.query(
      `SELECT id, decision, reason_code FROM hive.cost_guard_decisions
       WHERE project_id = $1::uuid`,
      [PROJECT_ID],
    )).rows.length >= 5);
    await assert.rejects(
      database.query('SELECT consumed_amount FROM hive.cost_guard_reservations LIMIT 1'),
      /permission denied|privilege/i,
    );
    await assert.rejects(
      database.query(
        `SELECT hive.reserve_project_cost(
          $1::uuid, $2::uuid, 'forged-browser-operation',
          'REFERENCE_APP_RUN_JOB', 1, 'BRL', '{}'::jsonb
        )`,
        [PROJECT_ID, budget.id],
      ),
      /permission denied|privilege/i,
    );
    await assert.rejects(
      database.query('DELETE FROM hive.cost_guard_reservations'),
      /permission denied|privilege/i,
    );

    await setContext(database, ADMIN_ID, 'REFERENCE_APP', null, 'PLATFORM_ADMIN');
    assert.ok((await database.query('SELECT id, status FROM hive.cost_guard_reservations')).rows.length >= 3);
    await assert.rejects(
      costGuard.reserve(
        { ...contextA, platformRole: 'PLATFORM_ADMIN' },
        { ...allowedInput, operationId: 'cost-guard-admin-001' },
      ),
      hasCostGuardCode('COST_GUARD_ACCESS_DENIED'),
    );

    await database.exec('RESET ROLE;');
    const evidence = await database.query(
      `SELECT
         (SELECT count(*)::integer FROM hive.cost_guard_decisions
           WHERE project_id = $1::uuid) AS decisions,
         (SELECT count(*)::integer FROM hive.cost_guard_reservations
           WHERE project_id = $1::uuid) AS reservations,
         (SELECT count(*)::integer FROM hive.cost_events
           WHERE project_id = $1::uuid AND operation_id = 'cost-guard-consume-001') AS cost_events,
         (SELECT count(*)::integer FROM audit.events
           WHERE project_id = $1::uuid AND event_code = 'COST_GUARD_DECIDED') AS audit_events,
         (SELECT count(*)::integer FROM audit.events
           WHERE project_id = $1::uuid
             AND event_code = 'COST_GUARD_DECIDED'
             AND metadata::text ~* '(amount|provider|model|idempotency|operation)') AS leaked_audit`,
      [PROJECT_ID],
    );
    assert.equal(evidence.rows[0].decisions, evidence.rows[0].audit_events);
    assert.equal(evidence.rows[0].cost_events, 1);
    assert.equal(evidence.rows[0].leaked_audit, 0);
  } finally {
    await database.close();
  }
});
