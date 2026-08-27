import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import {
  AIGatewayError,
  AIGatewayService,
  FakeAIProvider,
  PostgresAIOperationRepository,
} from '../../packages/ai/dist/index.js';
import {
  BillingService,
  FakeBillingProvider,
  PostgresBillingRepository,
} from '../../packages/billing/dist/index.js';
import {
  CostGuardService,
  PostgresUsageCostRepository,
  UsageCostService,
} from '../../packages/cost-guard/dist/index.js';
import { TrustPolicyService } from '../../packages/trust/dist/index.js';
import { createReferenceAppAIConfiguration } from '../../apps/hive-reference-app/dist/index.js';
import { loadMigrationCatalog } from '../../scripts/lib/migration-catalog.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const USER_A_ID = '10000000-0000-4000-8000-000000000001';
const USER_B_ID = '10000000-0000-4000-8000-000000000002';
const ADMIN_ID = '10000000-0000-4000-8000-000000000003';
const ORGANIZATION_A_ID = '30000000-0000-4000-8000-000000000001';
const REFERENCE_APP_ID = '00000000-0000-4000-8000-000000000001';
const REFERENCE_PRICE_ID = '50000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000121';
const contextA = Object.freeze({
  userId: USER_A_ID,
  appCode: 'REFERENCE_APP',
  organizationId: ORGANIZATION_A_ID,
});

const authShim = `
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION auth.jwt()
  RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
  DECLARE raw_claims text;
  BEGIN
    raw_claims := current_setting('request.jwt.claims', true);
    IF raw_claims IS NULL OR btrim(raw_claims) = '' THEN RETURN '{}'::jsonb; END IF;
    BEGIN RETURN raw_claims::jsonb;
    EXCEPTION WHEN invalid_text_representation THEN RETURN '{}'::jsonb;
    END;
  END; $$;
  CREATE FUNCTION auth.uid()
  RETURNS uuid LANGUAGE sql STABLE SET search_path = ''
  AS $$ SELECT nullif(auth.jwt() ->> 'sub', '')::uuid; $$;
  CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  CREATE ROLE service_role NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;
  GRANT USAGE ON SCHEMA auth TO authenticated, service_role;
  GRANT EXECUTE ON FUNCTION auth.jwt() TO authenticated, service_role;
  GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, service_role;
`;

async function prepare(database) {
  await database.exec(authShim);
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
  for (const file of (await readdir(path.join(repositoryRoot, 'database', 'seeds'))).sort()) {
    if (file.endsWith('.sql')) {
      await database.exec(await readFile(path.join(repositoryRoot, 'database', 'seeds', file), 'utf8'));
    }
  }
  await database.exec(await readFile(
    path.join(repositoryRoot, 'database', 'tests', 'fixtures', '0001_rls_identities.sql'),
    'utf8',
  ));
}

async function setContext(database, userId, appCode, organizationId, platformRole = 'USER') {
  await database.query(
    `SELECT set_config('request.jwt.claims', $1, false),
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

function executor(database) {
  return { query(sql, parameters = []) { return database.query(sql, parameters); } };
}

function hasCode(code) {
  return (error) => error instanceof AIGatewayError && error.code === code;
}

test('GH-0503 executes an accounted tenant-safe AI operation with Audit and RLS evidence', async () => {
  const database = new PGlite({ extensions: { pgcrypto } });
  await database.waitReady;
  try {
    await prepare(database);
    await database.exec('SET ROLE authenticated;');
    await setContext(database, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    await database.query(
      `INSERT INTO hive.projects (id, organization_id, app_id, owner_user_id, name)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'AI Gateway Foundation')`,
      [PROJECT_ID, ORGANIZATION_A_ID, REFERENCE_APP_ID, USER_A_ID],
    );

    const db = executor(database);
    const billing = new BillingService(
      new PostgresBillingRepository(db),
      new FakeBillingProvider({ paymentOutcome: 'SUCCESS' }),
    );
    const purchase = await billing.createPurchase(contextA, {
      projectId: PROJECT_ID,
      productCode: 'REFERENCE_APP_SANDBOX',
      priceId: REFERENCE_PRICE_ID,
      idempotencyKey: 'ai-gateway-entitlement-0001',
    });
    await database.exec('RESET ROLE;');
    await billing.processPayment(contextA, purchase.id);

    const usageRepository = new PostgresUsageCostRepository(db);
    const usageCost = new UsageCostService(usageRepository);
    const budget = await usageCost.configureBudget(contextA, {
      projectId: PROJECT_ID,
      budgetType: 'AI',
      measurementKind: 'COST',
      unitCode: 'BRL',
      ceilingAmount: '1',
      cycleId: 'cycle-ai-gateway-001',
      idempotencyKey: 'ai-gateway-budget-0001',
    });

    const gateway = new AIGatewayService(createReferenceAppAIConfiguration(), {
      trustPolicy: new TrustPolicyService({
        configurationRelease: 'GREEN_HIVE_TRUST_V1',
        policyOverrides: [],
      }),
      costGuard: new CostGuardService(usageRepository),
      usageCost,
      operations: new PostgresAIOperationRepository(db),
    });
    await assert.rejects(
      gateway.execute({ ...contextA, userId: USER_B_ID }, {
        projectId: PROJECT_ID,
        budgetId: budget.id,
        operationId: 'ai-gateway-forged-context-0001',
        taskType: 'REFERENCE_APP_STRUCTURED_ECHO',
        input: 'forged context must fail before operation start',
        classification: 'INTERNAL',
      }),
      hasCode('AI_GATEWAY_ACCESS_DENIED'),
    );
    assert.equal((await database.query(
      `SELECT id FROM hive.ai_operations WHERE operation_id = 'ai-gateway-forged-context-0001'`,
    )).rows.length, 0);
    const result = await gateway.execute(contextA, {
      projectId: PROJECT_ID,
      budgetId: budget.id,
      operationId: 'ai-gateway-database-0001',
      taskType: 'REFERENCE_APP_STRUCTURED_ECHO',
      input: 'internal bounded context for deterministic integration',
      classification: 'INTERNAL',
    });
    assert.equal(result.outputMode, 'STRUCTURED');
    assert.equal(result.cost.actualAmount, '0.000008');

    await database.exec('RESET ROLE;');
    const evidence = await database.query(
      `SELECT
         (SELECT count(*)::integer FROM hive.ai_operations
           WHERE project_id = $1::uuid AND status = 'SUCCEEDED') AS operations,
         (SELECT count(*)::integer FROM hive.usage_events
           WHERE project_id = $1::uuid AND usage_code = 'AI_TOKENS') AS usage_events,
         (SELECT count(*)::integer FROM hive.cost_events
           WHERE project_id = $1::uuid AND service_code = 'AI_GATEWAY') AS cost_events,
         (SELECT count(*)::integer FROM audit.events
           WHERE project_id = $1::uuid AND event_code = 'AI_OPERATION_COMPLETED') AS audit_events,
         (SELECT count(*)::integer FROM audit.events
           WHERE project_id = $1::uuid
             AND event_code LIKE 'AI_OPERATION_%'
             AND metadata::text ~* '(input|prompt|output|content|fingerprint)') AS leaked_audit`,
      [PROJECT_ID],
    );
    assert.deepEqual(evidence.rows[0], {
      operations: 1, usage_events: 1, cost_events: 1, audit_events: 1, leaked_audit: 0,
    });
    const stored = (await database.query(
      `SELECT task_type, output_mode, output_schema_id, classification,
              provider_code, model_code, status, input_tokens, output_tokens,
              estimated_cost::text, actual_cost::text, safe_error_code
       FROM hive.ai_operations WHERE operation_id = 'ai-gateway-database-0001'`,
    )).rows[0];
    assert.deepEqual(stored, {
      task_type: 'REFERENCE_APP_STRUCTURED_ECHO',
      output_mode: 'STRUCTURED',
      output_schema_id: 'REFERENCE_APP_ECHO_V1',
      classification: 'INTERNAL',
      provider_code: 'GREEN_HIVE_FAKE_AI',
      model_code: 'FAKE_DETERMINISTIC_V1',
      status: 'SUCCEEDED',
      input_tokens: 6,
      output_tokens: 1,
      estimated_cost: '0.00051800',
      actual_cost: '0.00000800',
      safe_error_code: null,
    });
    const prohibitedColumns = await database.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'hive' AND table_name = 'ai_operations'
         AND column_name ~* '(prompt|raw|input_content|output_content|response|secret)'`,
    );
    assert.deepEqual(prohibitedColumns.rows, []);

    await database.exec('SET ROLE authenticated;');
    await setContext(database, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    assert.equal((await database.query(
      `SELECT operation_id, status FROM hive.ai_operations WHERE project_id = $1::uuid`,
      [PROJECT_ID],
    )).rows.length, 1);
    await assert.rejects(
      database.query('SELECT request_fingerprint_sha256 FROM hive.ai_operations'),
      /permission denied|privilege/i,
    );
    for (const statement of [
      `INSERT INTO hive.ai_operations (
         organization_id, app_id, project_id, owner_user_id, operation_id, task_type,
         output_mode, classification, provider_code, model_code, trust_policy_code,
         trust_decision, estimated_cost, currency, request_fingerprint_sha256
       ) VALUES (
         '${ORGANIZATION_A_ID}', '${REFERENCE_APP_ID}', '${PROJECT_ID}', '${USER_A_ID}',
         'browser-forged-operation', 'REFERENCE_APP_STRUCTURED_ECHO', 'TEXT', 'PUBLIC',
         'FORGED_PROVIDER', 'FORGED_MODEL', 'TRUST_PUBLIC_EXTERNAL', 'ALLOW', 1, 'BRL',
         '${'a'.repeat(64)}'
       )`,
      `UPDATE hive.ai_operations SET status = 'FAILED'`,
      `DELETE FROM hive.ai_operations`,
      `SELECT hive.start_ai_operation(
         '${PROJECT_ID}'::uuid, 'browser-forged-function', 'REFERENCE_APP_STRUCTURED_ECHO',
         'TEXT', NULL, 'PUBLIC', 'FORGED_PROVIDER', 'FORGED_MODEL',
         'TRUST_PUBLIC_EXTERNAL', 'ALLOW', NULL, '${'a'.repeat(64)}', 1, 'BRL'
       )`,
    ]) {
      await assert.rejects(database.query(statement), /permission denied|privilege/i);
    }

    await setContext(database, USER_B_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    assert.equal((await database.query('SELECT id FROM hive.ai_operations')).rows.length, 0);
    await setContext(database, USER_A_ID, 'OTHER_TEST_APP', ORGANIZATION_A_ID);
    assert.equal((await database.query('SELECT id FROM hive.ai_operations')).rows.length, 0);
    await setContext(database, ADMIN_ID, 'REFERENCE_APP', null, 'PLATFORM_ADMIN');
    assert.equal((await database.query('SELECT id, status FROM hive.ai_operations')).rows.length, 1);
    await assert.rejects(database.query('DELETE FROM hive.ai_operations'), /permission denied|privilege/i);

    await database.exec('RESET ROLE;');
    await setContext(database, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    const invalidGateway = new AIGatewayService(
      createReferenceAppAIConfiguration(new FakeAIProvider({ structuredOutput: { invalid: true } })),
      {
        trustPolicy: new TrustPolicyService({
          configurationRelease: 'GREEN_HIVE_TRUST_V1', policyOverrides: [],
        }),
        costGuard: new CostGuardService(usageRepository),
        usageCost,
        operations: new PostgresAIOperationRepository(db),
      },
    );
    await assert.rejects(
      invalidGateway.execute(contextA, {
        projectId: PROJECT_ID,
        budgetId: budget.id,
        operationId: 'ai-gateway-invalid-schema-0001',
        taskType: 'REFERENCE_APP_STRUCTURED_ECHO',
        input: 'schema failure remains safely accounted',
        classification: 'INTERNAL',
      }),
      hasCode('AI_GATEWAY_OUTPUT_SCHEMA_INVALID'),
    );
    await database.exec('RESET ROLE;');
    const failed = (await database.query(
      `SELECT status, safe_error_code FROM hive.ai_operations
       WHERE operation_id = 'ai-gateway-invalid-schema-0001'`,
    )).rows[0];
    assert.deepEqual(failed, {
      status: 'FAILED', safe_error_code: 'AI_GATEWAY_OUTPUT_SCHEMA_INVALID',
    });
    assert.equal((await database.query(
      `SELECT id FROM audit.events
       WHERE project_id = $1::uuid AND event_code = 'AI_OPERATION_FAILED'`,
      [PROJECT_ID],
    )).rows.length, 1);
  } finally {
    await database.close();
  }
});
