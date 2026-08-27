import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import pg from 'pg';
import {
  AIGatewayService,
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
  USER_B_ID,
} from './helpers/rls-matrix.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const databaseUrl = process.env.GREEN_HIVE_TEST_DATABASE_URL;
const confirmation = process.env.GREEN_HIVE_TEST_CONFIRM;
const target = process.env.GREEN_HIVE_TEST_TARGET;
const isStaging = target === SUPABASE_STAGING_TARGET;
const PROJECT_ID = '20000000-0000-4000-8000-000000000121';
const REFERENCE_PRICE_ID = '50000000-0000-4000-8000-000000000001';
const context = Object.freeze({
  userId: USER_A_ID,
  appCode: 'REFERENCE_APP',
  organizationId: ORGANIZATION_A_ID,
});

function executor(client) {
  return { query(sql, parameters = []) { return client.query(sql, parameters); } };
}

async function setContext(client, subject, appCode, organizationId, platformRole = 'USER') {
  await client.query(
    `SELECT set_config('request.jwt.claims', $1, false),
            set_config('request.green_hive.organization_id', $2, false)`,
    [
      JSON.stringify({
        sub: subject,
        app_metadata: { app_code: appCode, platform_role: platformRole },
      }),
      organizationId ?? '',
    ],
  );
}

test(
  'GH-0503 AI Gateway accounting and isolation on native Supabase',
  { skip: !databaseUrl || !confirmation ? 'local Supabase gate not configured' : false },
  async () => {
    if (isStaging) {
      const staging = stagingDatabaseConfigurationFromEnvironment();
      assert.equal(staging.databaseUrl.toString(), new URL(databaseUrl).toString());
      assert.equal(process.env.GREEN_HIVE_TEST_PREPARED, 'SUPABASE_STAGING_BASELINE_READY');
    } else {
      assertLocalSupabaseTarget({ databaseUrl, target, confirmation });
    }

    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await assertNativeSupabaseContract(client);
      const catalog = await loadMigrationCatalog(repositoryRoot);
      const baseline = await client.query(
        `SELECT
           (SELECT count(*)::integer FROM hive.schema_migrations) AS migrations,
           to_regclass('hive.ai_operations') IS NOT NULL AS operations_ready,
           to_regprocedure(
             'hive.start_ai_operation(uuid,text,text,text,text,text,text,text,text,text,text,text,numeric,text)'
           ) IS NOT NULL AS start_ready,
           has_function_privilege(
             'authenticated',
             'hive.start_ai_operation(uuid,text,text,text,text,text,text,text,text,text,text,text,numeric,text)',
             'EXECUTE'
           ) AS authenticated_start,
           has_function_privilege(
             'service_role',
             'hive.start_ai_operation(uuid,text,text,text,text,text,text,text,text,text,text,text,numeric,text)',
             'EXECUTE'
           ) AS service_start`,
      );
      assert.deepEqual(baseline.rows[0], {
        migrations: catalog.migrations.length,
        operations_ready: true,
        start_ready: true,
        authenticated_start: false,
        service_start: true,
      });

      await cleanupGreenHiveFixtures(client);
      await client.query(await readFile(
        path.join(repositoryRoot, 'database', 'tests', 'fixtures', '0001_rls_identities.sql'),
        'utf8',
      ));
      await client.query('SET ROLE authenticated');
      await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
      await client.query(
        `INSERT INTO hive.projects (id, organization_id, app_id, owner_user_id, name)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Native AI Gateway')`,
        [PROJECT_ID, ORGANIZATION_A_ID, REFERENCE_APP_ID, USER_A_ID],
      );

      const db = executor(client);
      const billing = new BillingService(
        new PostgresBillingRepository(db),
        new FakeBillingProvider({ paymentOutcome: 'SUCCESS' }),
      );
      const purchase = await billing.createPurchase(context, {
        projectId: PROJECT_ID,
        productCode: 'REFERENCE_APP_SANDBOX',
        priceId: REFERENCE_PRICE_ID,
        idempotencyKey: 'native-ai-gateway-entitlement-0001',
      });
      await client.query('RESET ROLE');
      await billing.processPayment(context, purchase.id);
      const repository = new PostgresUsageCostRepository(db);
      const usageCost = new UsageCostService(repository);
      const budget = await usageCost.configureBudget(context, {
        projectId: PROJECT_ID,
        budgetType: 'AI',
        measurementKind: 'COST',
        unitCode: 'BRL',
        ceilingAmount: '1',
        cycleId: 'native-ai-gateway-cycle',
        idempotencyKey: 'native-ai-gateway-budget-0001',
      });
      const gateway = new AIGatewayService(createReferenceAppAIConfiguration(), {
        trustPolicy: new TrustPolicyService({
          configurationRelease: 'GREEN_HIVE_TRUST_V1', policyOverrides: [],
        }),
        costGuard: new CostGuardService(repository),
        usageCost,
        operations: new PostgresAIOperationRepository(db),
      });
      const result = await gateway.execute(context, {
        projectId: PROJECT_ID,
        budgetId: budget.id,
        operationId: 'native-ai-gateway-operation-0001',
        taskType: 'REFERENCE_APP_STRUCTURED_ECHO',
        input: 'native Supabase bounded AI context',
        classification: 'INTERNAL',
      });
      assert.equal(result.outputMode, 'STRUCTURED');
      assert.equal(result.providerCode, 'GREEN_HIVE_FAKE_AI');

      const evidence = await client.query(
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
             WHERE project_id = $1::uuid AND event_code LIKE 'AI_OPERATION_%'
               AND metadata::text ~* '(input|prompt|output|content|fingerprint)') AS leaked`,
        [PROJECT_ID],
      );
      assert.deepEqual(evidence.rows[0], {
        operations: 1, usage_events: 1, cost_events: 1, audit_events: 1, leaked: 0,
      });

      await client.query('SET ROLE authenticated');
      await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
      assert.equal((await client.query(
        'SELECT operation_id, status FROM hive.ai_operations WHERE project_id = $1::uuid',
        [PROJECT_ID],
      )).rows.length, 1);
      await assert.rejects(
        client.query('SELECT request_fingerprint_sha256 FROM hive.ai_operations'),
        /permission denied|privilege/i,
      );
      await assert.rejects(
        client.query('DELETE FROM hive.ai_operations'),
        /permission denied|privilege/i,
      );
      await setContext(client, USER_B_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
      assert.equal((await client.query('SELECT id FROM hive.ai_operations')).rows.length, 0);
      await setContext(client, USER_A_ID, 'OTHER_TEST_APP', ORGANIZATION_A_ID);
      assert.equal((await client.query('SELECT id FROM hive.ai_operations')).rows.length, 0);
      await setContext(client, ADMIN_ID, 'REFERENCE_APP', null, 'PLATFORM_ADMIN');
      assert.equal((await client.query('SELECT id, status FROM hive.ai_operations')).rows.length, 1);
      await assert.rejects(client.query('UPDATE hive.ai_operations SET status = status'), /permission denied|privilege/i);
    } finally {
      await client.query('RESET ROLE').catch(() => undefined);
      await cleanupGreenHiveFixtures(client).catch(() => undefined);
      await client.end();
    }
  },
);
