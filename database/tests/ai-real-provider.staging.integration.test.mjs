import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import pg from 'pg';
import {
  AIGatewayService,
  OPENAI_CANONICAL_MODEL_CODE,
  OPENAI_PROVIDER_CODE,
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
import {
  createReferenceAppOpenAIStagingConfiguration,
  REFERENCE_APP_AI_SCHEMA_ID,
  REFERENCE_APP_AI_TASK_TYPE,
} from '../../apps/hive-reference-app/dist/index.js';
import {
  assertNativeSupabaseContract,
  cleanupGreenHiveFixtures,
} from '../../scripts/lib/local-supabase-guard.mjs';
import {
  createRealAIStagingAttemptMarker,
  REAL_AI_STAGING_OPERATION_ID,
  realAIStagingConfigurationFromEnvironment,
} from '../../scripts/lib/real-ai-staging-guard.mjs';
import { loadMigrationCatalog } from '../../scripts/lib/migration-catalog.mjs';
import {
  ORGANIZATION_A_ID,
  REFERENCE_APP_ID,
  USER_A_ID,
} from './helpers/rls-matrix.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROJECT_ID = '20000000-0000-4000-8000-000000000124';
const REFERENCE_PRICE_ID = '50000000-0000-4000-8000-000000000001';
const BUDGET_CEILING_USD = '0.0002';
const INPUT = 'Return the readiness result.';
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

function decimal(value) {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, '0'));
}

test('GH-0504 performs one controlled OpenAI call through the staging AI Gateway', async () => {
  // Intentionally no skip: a manual paid gate invoked without every guard must fail closed.
  const staging = realAIStagingConfigurationFromEnvironment();
  assert.equal(
    staging.databaseUrl.toString(),
    new URL(process.env.GREEN_HIVE_TEST_DATABASE_URL).toString(),
  );
  assert.equal(process.env.GREEN_HIVE_TEST_TARGET, 'SUPABASE_STAGING');
  assert.equal(process.env.GREEN_HIVE_TEST_CONFIRM, 'GREEN_HIVE_DEDICATED_STAGING');
  assert.equal(process.env.GREEN_HIVE_TEST_PREPARED, 'SUPABASE_STAGING_BASELINE_READY');

  const client = new pg.Client({ connectionString: staging.databaseUrl.toString() });
  await client.connect();
  try {
    await assertNativeSupabaseContract(client);
    const catalog = await loadMigrationCatalog(repositoryRoot);
    const baseline = await client.query(
      `SELECT
         (SELECT count(*)::integer FROM hive.schema_migrations) AS migrations,
         to_regclass('hive.ai_operations') IS NOT NULL AS operations_ready,
         to_regclass('hive.cost_guard_reservations') IS NOT NULL AS reservations_ready,
         to_regprocedure(
           'hive.start_ai_operation(uuid,text,text,text,text,text,text,text,text,text,text,text,numeric,text)'
         ) IS NOT NULL AS start_ready`,
    );
    assert.deepEqual(baseline.rows[0], {
      migrations: catalog.migrations.length,
      operations_ready: true,
      reservations_ready: true,
      start_ready: true,
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
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'GH-0504 controlled provider gate')`,
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
      idempotencyKey: 'gh0504-real-provider-entitlement-v0210',
    });
    await client.query('RESET ROLE');
    await billing.processPayment(context, purchase.id);

    const repository = new PostgresUsageCostRepository(db);
    const usageCost = new UsageCostService(repository);
    const budget = await usageCost.configureBudget(context, {
      projectId: PROJECT_ID,
      budgetType: 'AI',
      measurementKind: 'COST',
      unitCode: 'USD',
      ceilingAmount: BUDGET_CEILING_USD,
      cycleId: 'gh0504-openai-v0210-once',
      idempotencyKey: 'gh0504-openai-budget-v0210-0001',
    });

    const before = await client.query(
      `SELECT
         (SELECT count(*)::integer FROM hive.ai_operations
           WHERE operation_id = $1) AS operations,
         (SELECT count(*)::integer FROM hive.usage_events
           WHERE operation_id = $1) AS usage_events,
         (SELECT count(*)::integer FROM hive.cost_events
           WHERE operation_id = $1) AS cost_events,
         (SELECT count(*)::integer FROM hive.cost_guard_reservations
           WHERE operation_id = $1) AS reservations`,
      [REAL_AI_STAGING_OPERATION_ID],
    );
    assert.deepEqual(before.rows[0], {
      operations: 0,
      usage_events: 0,
      cost_events: 0,
      reservations: 0,
    });

    const configuration = createReferenceAppOpenAIStagingConfiguration(staging.apiKey);
    assert.equal(configuration.providers.length, 1);
    assert.equal(configuration.providers[0].providerCode, OPENAI_PROVIDER_CODE);
    const model = configuration.models.find((candidate) => (
      candidate.modelCode === OPENAI_CANONICAL_MODEL_CODE
    ));
    const task = configuration.tasks.find((candidate) => (
      candidate.taskType === REFERENCE_APP_AI_TASK_TYPE
    ));
    assert.ok(model?.enabled);
    assert.equal(model.currency, 'USD');
    assert.ok(task);
    assert.equal(task.outputSchemaId, REFERENCE_APP_AI_SCHEMA_ID);
    assert.equal(task.retryPolicy.maxAttempts, 1);
    assert.deepEqual(task.retryPolicy.retryableProviderErrors, []);

    const gateway = new AIGatewayService(configuration, {
      trustPolicy: new TrustPolicyService({
        configurationRelease: 'GREEN_HIVE_TRUST_V1', policyOverrides: [],
      }),
      costGuard: new CostGuardService(repository),
      usageCost,
      operations: new PostgresAIOperationRepository(db),
    });

    // CreateNew semantics make this a one-shot paid boundary even if the provider fails or the
    // process is interrupted. The marker is intentionally never deleted by fixture cleanup.
    await createRealAIStagingAttemptMarker(staging.attemptPath);

    // This is the only gateway execution in this file. maxAttempts=1 makes it one HTTP call.
    const result = await gateway.execute(context, {
      projectId: PROJECT_ID,
      budgetId: budget.id,
      operationId: REAL_AI_STAGING_OPERATION_ID,
      taskType: REFERENCE_APP_AI_TASK_TYPE,
      input: INPUT,
      classification: 'INTERNAL',
    });
    assert.equal(result.outputMode, 'STRUCTURED');
    assert.equal(result.outputSchemaId, REFERENCE_APP_AI_SCHEMA_ID);
    assert.equal(result.providerCode, OPENAI_PROVIDER_CODE);
    assert.equal(result.modelCode, OPENAI_CANONICAL_MODEL_CODE);
    assert.deepEqual(result.value, { result: 'REFERENCE_APP_AI_SUCCESS' });
    assert.ok(Number.isInteger(result.usage.inputTokens) && result.usage.inputTokens > 0);
    assert.ok(Number.isInteger(result.usage.outputTokens) && result.usage.outputTokens > 0);
    assert.equal(result.cost.currency, 'USD');
    assert.equal(result.cost.estimatedAmount, '0.0001926');
    assert.ok(decimal(result.cost.actualAmount) > 0n);
    assert.ok(decimal(result.cost.actualAmount) <= decimal(result.cost.estimatedAmount));
    assert.ok(decimal(result.cost.estimatedAmount) <= decimal(BUDGET_CEILING_USD));
    assert.ok(decimal(result.cost.estimatedAmount) * 2n > decimal(BUDGET_CEILING_USD));
    assert.deepEqual(result.trust, {
      configurationRelease: 'GREEN_HIVE_TRUST_V1',
      policyCode: 'TRUST_INTERNAL_EXTERNAL',
      decision: 'ALLOW',
      sanitizationMode: null,
    });

    const evidence = await client.query(
      `SELECT
         operation.operation_id,
         operation.status,
         operation.task_type,
         operation.output_schema_id,
         operation.classification,
         operation.provider_code,
         operation.model_code,
         operation.input_tokens,
         operation.output_tokens,
         trim_scale(operation.estimated_cost)::text AS estimated_cost,
         trim_scale(operation.actual_cost)::text AS actual_cost,
         operation.currency,
         operation.safe_error_code,
         (SELECT count(*)::integer FROM hive.usage_events AS usage
           WHERE usage.project_id = operation.project_id
             AND usage.operation_id = operation.operation_id
             AND usage.usage_code = 'AI_TOKENS'
             AND usage.provider_code = operation.provider_code
             AND usage.service_code = 'AI_GATEWAY') AS usage_events,
         (SELECT trim_scale(usage.quantity)::text FROM hive.usage_events AS usage
           WHERE usage.project_id = operation.project_id
             AND usage.operation_id = operation.operation_id
             AND usage.usage_code = 'AI_TOKENS') AS usage_quantity,
         (SELECT count(*)::integer FROM hive.cost_events AS cost
           WHERE cost.project_id = operation.project_id
             AND cost.operation_id = operation.operation_id
             AND cost.provider_code = operation.provider_code
             AND cost.model_code = operation.model_code
             AND cost.currency = operation.currency
             AND cost.service_code = 'AI_GATEWAY') AS cost_events,
         (SELECT trim_scale(cost.amount)::text FROM hive.cost_events AS cost
           WHERE cost.project_id = operation.project_id
             AND cost.operation_id = operation.operation_id
             AND cost.service_code = 'AI_GATEWAY') AS ledger_cost,
         (SELECT count(*)::integer FROM hive.cost_guard_reservations AS reservation
           WHERE reservation.project_id = operation.project_id
             AND reservation.operation_id = operation.operation_id
             AND reservation.status = 'CONSUMED') AS consumed_reservations,
         (SELECT count(*)::integer FROM audit.events AS event
           WHERE event.project_id = operation.project_id
             AND event.event_code = 'AI_OPERATION_COMPLETED'
             AND event.metadata ->> 'provider_code' = operation.provider_code
             AND event.metadata ->> 'model_code' = operation.model_code) AS audit_events
       FROM hive.ai_operations AS operation
       WHERE operation.project_id = $1::uuid AND operation.operation_id = $2`,
      [PROJECT_ID, REAL_AI_STAGING_OPERATION_ID],
    );
    assert.equal(evidence.rows.length, 1);
    assert.deepEqual(evidence.rows[0], {
      operation_id: REAL_AI_STAGING_OPERATION_ID,
      status: 'SUCCEEDED',
      task_type: REFERENCE_APP_AI_TASK_TYPE,
      output_schema_id: REFERENCE_APP_AI_SCHEMA_ID,
      classification: 'INTERNAL',
      provider_code: OPENAI_PROVIDER_CODE,
      model_code: OPENAI_CANONICAL_MODEL_CODE,
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
      estimated_cost: result.cost.estimatedAmount,
      actual_cost: result.cost.actualAmount,
      currency: 'USD',
      safe_error_code: null,
      usage_events: 1,
      usage_quantity: String(result.usage.inputTokens + result.usage.outputTokens),
      cost_events: 1,
      ledger_cost: result.cost.actualAmount,
      consumed_reservations: 1,
      audit_events: 1,
    });

    const safeMetadata = await client.query(
      `SELECT source, metadata
       FROM (
         SELECT 'usage'::text AS source, metadata
         FROM hive.usage_events WHERE project_id = $1::uuid AND operation_id = $2
         UNION ALL
         SELECT 'cost'::text AS source, metadata
         FROM hive.cost_events WHERE project_id = $1::uuid AND operation_id = $2
         UNION ALL
         SELECT 'audit'::text AS source, metadata
         FROM audit.events WHERE project_id = $1::uuid AND event_code = 'AI_OPERATION_COMPLETED'
       ) AS evidence`,
      [PROJECT_ID, REAL_AI_STAGING_OPERATION_ID],
    );
    const forbiddenMetadataKeys = new Set([
      'authorization', 'content', 'cookie', 'document', 'password', 'payload',
      'prompt', 'secret', 'signature', 'token',
    ]);
    for (const row of safeMetadata.rows) {
      assert.equal(
        Object.keys(row.metadata).some((key) => forbiddenMetadataKeys.has(key.toLowerCase())),
        false,
      );
    }
    const serializedEvidence = JSON.stringify([...evidence.rows, ...safeMetadata.rows]);
    assert.equal(serializedEvidence.includes(INPUT), false);
    assert.equal(serializedEvidence.includes(staging.apiKey), false);
  } finally {
    await client.query('RESET ROLE').catch(() => undefined);
    await cleanupGreenHiveFixtures(client).catch(() => undefined);
    await client.end();
  }
});
