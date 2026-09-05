import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import {
  PostgresUsageCostRepository,
  UsageCostError,
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
const PROJECT_ID = '20000000-0000-4000-8000-000000000117';

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

function hasCode(code) {
  return (error) => error instanceof UsageCostError && error.code === code;
}

test('GH-0401 persists isolated idempotent usage and cost ledgers as independent accounting evidence', async () => {
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
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Usage Cost Integration Project')`,
      [PROJECT_ID, ORGANIZATION_A_ID, REFERENCE_APP_ID, USER_A_ID],
    );

    const service = new UsageCostService(
      new PostgresUsageCostRepository({
        query(sql, parameters = []) {
          return database.query(sql, parameters);
        },
      }),
    );

    await assert.rejects(
      service.configureBudget(contextA, {
        projectId: PROJECT_ID,
        budgetType: 'AI',
        measurementKind: 'USAGE',
        unitCode: 'TOKENS',
        ceilingAmount: '1000',
        idempotencyKey: 'budget-ai-tokens-0001',
      }),
      hasCode('USAGE_COST_OPERATION_FAILED'),
    );
    await assert.rejects(
      database.query(
        `SELECT hive.configure_usage_budget(
          $1::uuid, 'AI', 'USAGE', 'TOKENS', 1000, NULL, NULL, NULL,
          'budget-ai-tokens-0001', '{}'::jsonb
        )`,
        [PROJECT_ID],
      ),
      /permission denied|privilege/i,
    );

    await database.exec('RESET ROLE;');
    const usageBudgetInput = {
      projectId: PROJECT_ID,
      budgetType: 'AI',
      measurementKind: 'USAGE',
      unitCode: 'TOKENS',
      ceilingAmount: '1000.00000000',
      cycleId: 'cycle-001',
      idempotencyKey: 'budget-ai-tokens-0001',
      metadata: { source: 'test' },
    };
    const usageBudget = await service.configureBudget(contextA, usageBudgetInput);
    const usageBudgetReplay = await service.configureBudget(contextA, {
      ...usageBudgetInput,
      ceilingAmount: '1000.0',
    });
    assert.equal(usageBudgetReplay.id, usageBudget.id);
    assert.equal(usageBudget.ceilingAmount, '1000.00000000');
    assert.equal(usageBudget.consumedAmount, '0.00000000');
    assert.equal(usageBudget.reservedAmount, '0.00000000');

    await assert.rejects(
      service.configureBudget(contextA, { ...usageBudgetInput, ceilingAmount: '900' }),
      hasCode('USAGE_COST_IDEMPOTENCY_CONFLICT'),
    );

    const costBudget = await service.configureBudget(contextA, {
      projectId: PROJECT_ID,
      budgetType: 'TOTAL_COST',
      measurementKind: 'COST',
      unitCode: 'BRL',
      ceilingAmount: '25',
      cycleId: 'cycle-001',
      idempotencyKey: 'budget-total-cost-0001',
    });

    const debitInput = {
      projectId: PROJECT_ID,
      budgetId: usageBudget.id,
      operationId: 'operation-usage-001',
      idempotencyKey: 'usage-operation-0001',
      eventKind: 'DEBIT',
      usageCode: 'AI_INPUT_TOKENS',
      quantity: '10.5',
      unitCode: 'TOKENS',
      capabilityCode: 'REFERENCE_APP_RUN_JOB',
      cycleId: 'cycle-001',
      providerCode: 'SANDBOX',
      serviceCode: 'REFERENCE_APP',
      metadata: { cached: false },
    };
    const debit = await service.recordUsage(contextA, debitInput);
    const debitReplay = await service.recordUsage(contextA, debitInput);
    assert.equal(debitReplay.id, debit.id);
    assert.equal(debit.quantity, '10.50000000');

    await assert.rejects(
      service.recordUsage(contextA, { ...debitInput, quantity: '11' }),
      hasCode('USAGE_COST_IDEMPOTENCY_CONFLICT'),
    );

    await service.recordUsage(contextA, {
      ...debitInput,
      operationId: 'operation-usage-credit-001',
      idempotencyKey: 'usage-operation-credit-0001',
      eventKind: 'CREDIT',
      quantity: '3',
    });
    const cost = await service.recordCost(contextA, {
      projectId: PROJECT_ID,
      budgetId: costBudget.id,
      operationId: 'operation-cost-001',
      idempotencyKey: 'cost-operation-0001',
      eventKind: 'DEBIT',
      amount: '0.01234567',
      currency: 'BRL',
      providerCode: 'SANDBOX',
      serviceCode: 'REFERENCE_APP',
      modelCode: 'sandbox-model-v1',
      cycleId: 'cycle-001',
      metadata: { source: 'sandbox' },
    });
    assert.equal(cost.amount, '0.01234567');

    assert.equal((await service.listBudgets(contextA, PROJECT_ID)).length, 2);
    assert.equal((await service.listUsageEvents(contextA, PROJECT_ID)).length, 2);
    assert.deepEqual(await service.summarizeUsage(contextA, PROJECT_ID), [
      {
        usageCode: 'AI_INPUT_TOKENS',
        unitCode: 'TOKENS',
        cycleId: 'cycle-001',
        debitedQuantity: '10.50000000',
        creditedQuantity: '3.00000000',
        netQuantity: '7.50000000',
      },
    ]);

    await setContext(database, USER_B_ID, 'REFERENCE_APP', ORGANIZATION_B_ID);
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
        { ...debitInput, idempotencyKey: 'usage-cross-user-0001' },
      ),
      hasCode('USAGE_COST_ACCESS_DENIED'),
    );

    await setContext(database, USER_A_ID, 'OTHER_TEST_APP', ORGANIZATION_A_ID);
    await assert.rejects(
      service.recordCost(
        { ...contextA, appCode: 'OTHER_TEST_APP' },
        {
          projectId: PROJECT_ID,
          operationId: 'operation-cross-app-001',
          idempotencyKey: 'cost-cross-app-0001',
          eventKind: 'DEBIT',
          amount: '1',
          currency: 'BRL',
          providerCode: 'SANDBOX',
          serviceCode: 'REFERENCE_APP',
        },
      ),
      hasCode('USAGE_COST_ACCESS_DENIED'),
    );

    await database.exec('SET ROLE authenticated;');
    await setContext(database, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    assert.equal(
      (await database.query('SELECT id FROM hive.usage_budgets WHERE project_id = $1::uuid', [PROJECT_ID])).rows.length,
      2,
    );
    assert.equal(
      (await database.query('SELECT id FROM hive.usage_events WHERE project_id = $1::uuid', [PROJECT_ID])).rows.length,
      2,
    );
    assert.equal(
      (await database.query('SELECT id FROM hive.cost_events WHERE project_id = $1::uuid', [PROJECT_ID])).rows.length,
      0,
    );
    await assert.rejects(
      database.query("UPDATE hive.usage_budgets SET consumed_amount = 1 WHERE id = $1::uuid", [usageBudget.id]),
      /permission denied|privilege/i,
    );
    await assert.rejects(
      database.query('DELETE FROM hive.usage_events WHERE id = $1::uuid', [debit.id]),
      /permission denied|privilege/i,
    );

    await setContext(database, ADMIN_ID, 'REFERENCE_APP', null, 'PLATFORM_ADMIN');
    assert.equal((await database.query('SELECT id FROM hive.cost_events')).rows.length, 1);
    assert.equal((await database.query('SELECT id FROM hive.usage_events')).rows.length, 2);
    await assert.rejects(
      service.listBudgets({ ...contextA, platformRole: 'PLATFORM_ADMIN' }, PROJECT_ID),
      hasCode('USAGE_COST_ACCESS_DENIED'),
    );
    await assert.rejects(
      database.query(
        `INSERT INTO hive.cost_events (
          organization_id, app_id, project_id, owner_user_id, operation_id,
          idempotency_key_sha256, event_fingerprint_sha256, event_kind, amount,
          currency, provider_code, service_code, occurred_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'forged-admin',
          repeat('a', 64), repeat('b', 64), 'DEBIT', 1, 'BRL', 'SANDBOX',
          'REFERENCE_APP', now()
        )`,
        [ORGANIZATION_A_ID, REFERENCE_APP_ID, PROJECT_ID, USER_A_ID],
      ),
      /permission denied|privilege/i,
    );

    await database.exec('RESET ROLE;');
    const evidence = await database.query(
      `SELECT
         (SELECT count(*)::integer FROM hive.usage_budgets WHERE project_id = $1::uuid) AS budgets,
         (SELECT count(*)::integer FROM hive.usage_events WHERE project_id = $1::uuid) AS usage_events,
         (SELECT count(*)::integer FROM hive.cost_events WHERE project_id = $1::uuid) AS cost_events,
         (SELECT count(*)::integer
            FROM audit.events
           WHERE project_id = $1::uuid
             AND event_code = 'USAGE_BUDGET_CONFIGURED'
             AND subject_type = 'USAGE_BUDGET') AS budget_audit_events`,
      [PROJECT_ID],
    );
    assert.deepEqual(evidence.rows[0], {
      budgets: 2,
      usage_events: 2,
      cost_events: 1,
      budget_audit_events: 2,
    });
    const accountingAudit = await database.query(
      `SELECT count(*)::integer AS leaked
       FROM audit.events
       WHERE project_id = $1::uuid
         AND metadata::text ~* '(amount|quantity|provider|model|idempotency)'`,
      [PROJECT_ID],
    );
    assert.equal(accountingAudit.rows[0].leaked, 0);
  } finally {
    await database.close();
  }
});
