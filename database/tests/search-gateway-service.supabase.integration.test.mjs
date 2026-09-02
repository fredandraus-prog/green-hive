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
  CostGuardService,
  PostgresUsageCostRepository,
  UsageCostService,
} from '../../packages/cost-guard/dist/index.js';
import {
  SEARCH_CONTENT_TRUST,
  FakeSearchProvider,
  PostgresSearchOperationRepository,
  SearchGatewayError,
  SearchGatewayService,
} from '../../packages/search/dist/index.js';
import { TrustPolicyService } from '../../packages/trust/dist/index.js';
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
const PROJECT_ID = '20000000-0000-4000-8000-000000000122';
const REFERENCE_PRICE_ID = '50000000-0000-4000-8000-000000000001';
const SEARCH_TYPE = 'REFERENCE_APP_FAKE_SEARCH';
const CAPABILITY_CODE = 'REFERENCE_APP_RUN_JOB';
const PROVIDER_CODE = 'GREEN_HIVE_FAKE_SEARCH';
const RAW_QUERY_MARKER = 'PRIVATE_SEARCH_QUERY_7F2A';
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

function hasCode(code) {
  return (error) => error instanceof SearchGatewayError && error.code === code;
}

function createSearchConfiguration(provider) {
  return {
    configurationRelease: 'REFERENCE_APP_SEARCH_V1',
    providers: [provider],
    registrations: [{
      providerClass: 'DETERMINISTIC_SEARCH',
      providerCode: PROVIDER_CODE,
      enabled: true,
      priority: 100,
      maxResults: 10,
      requestCost: '0.0001',
      resultCost: '0.00002',
      currency: 'USD',
    }],
    tasks: [{
      searchType: SEARCH_TYPE,
      sensitivityMax: 'CONFIDENTIAL',
      preferredProviderClass: 'DETERMINISTIC_SEARCH',
      maxQueryCharacters: 256,
      maxResults: 2,
      costBudgetType: 'SEARCH',
      cachePolicy: 'NONE',
      retryPolicy: { maxAttempts: 1, retryableProviderErrors: [] },
      capabilityCode: CAPABILITY_CODE,
      sanitizer: {
        mode: 'ABSTRACT_QUERY',
        sanitize(query) {
          return `ABSTRACT_QUERY word_count=${query.trim().split(/\s+/).length}`;
        },
      },
    }],
  };
}

function executeInput(operationId) {
  return {
    projectId: PROJECT_ID,
    budgetId: undefined,
    operationId,
    searchType: SEARCH_TYPE,
    query: `${RAW_QUERY_MARKER} private customer context`,
    classification: 'PUBLIC',
  };
}

function operationStartInput(operationId, searchType = SEARCH_TYPE) {
  return {
    projectId: PROJECT_ID,
    operationId,
    searchType,
    capabilityCode: CAPABILITY_CODE,
    classification: 'PUBLIC',
    providerCode: PROVIDER_CODE,
    trustPolicyCode: 'REFERENCE_APP_PUBLIC_FAKE_SEARCH',
    trustDecision: 'ALLOW',
    sanitizationMode: null,
    maxResults: 2,
    cacheStatus: 'NOT_APPLICABLE',
    estimatedCost: '0.00014',
    currency: 'USD',
    requestFingerprint: 'a'.repeat(64),
  };
}

test(
  'GH-0505 Search Gateway accounting, metadata minimization and RLS on native Supabase',
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
           to_regclass('hive.search_operations') IS NOT NULL AS operations_ready,
           EXISTS (
             SELECT 1
             FROM pg_class AS relation
             JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
             WHERE namespace.nspname = 'hive'
               AND relation.relname = 'search_operations'
               AND relation.relrowsecurity
               AND relation.relforcerowsecurity
           ) AS rls_ready,
           to_regprocedure(
             'hive.start_search_operation(uuid,text,text,text,text,text,text,text,text,integer,text,text,numeric,text)'
           ) IS NOT NULL AS start_ready,
           to_regprocedure(
             'hive.complete_search_operation(text,integer,integer,numeric,text)'
           ) IS NOT NULL AS simple_complete_ready,
           to_regprocedure(
             'hive.complete_search_operation_accounted(text,uuid,integer,integer,numeric,text)'
           ) IS NOT NULL AS accounted_complete_ready,
           to_regprocedure('hive.fail_search_operation(text,text)') IS NOT NULL AS fail_ready,
           to_regprocedure(
             'hive.fail_search_operation_accounted(text,uuid,text)'
           ) IS NOT NULL AS accounted_fail_ready,
           has_any_column_privilege(
             'authenticated', 'hive.search_operations', 'SELECT'
           ) AS authenticated_read,
           has_column_privilege(
             'authenticated', 'hive.search_operations', 'request_fingerprint_sha256', 'SELECT'
           ) AS authenticated_fingerprint,
           has_table_privilege(
             'authenticated', 'hive.search_operations', 'INSERT,UPDATE,DELETE'
           ) AS authenticated_write,
           has_function_privilege(
             'authenticated',
             'hive.start_search_operation(uuid,text,text,text,text,text,text,text,text,integer,text,text,numeric,text)',
             'EXECUTE'
           ) AS authenticated_start,
           has_function_privilege(
             'service_role',
             'hive.start_search_operation(uuid,text,text,text,text,text,text,text,text,integer,text,text,numeric,text)',
             'EXECUTE'
           ) AS service_start,
           has_function_privilege(
             'authenticated',
             'hive.complete_search_operation(text,integer,integer,numeric,text)',
             'EXECUTE'
           ) AS authenticated_simple_complete,
           has_function_privilege(
             'service_role',
             'hive.complete_search_operation(text,integer,integer,numeric,text)',
             'EXECUTE'
           ) AS service_simple_complete,
           has_function_privilege(
             'authenticated',
             'hive.complete_search_operation_accounted(text,uuid,integer,integer,numeric,text)',
             'EXECUTE'
           ) AS authenticated_accounted_complete,
           has_function_privilege(
             'service_role',
             'hive.complete_search_operation_accounted(text,uuid,integer,integer,numeric,text)',
             'EXECUTE'
           ) AS service_accounted_complete,
           has_function_privilege(
             'authenticated',
             'hive.fail_search_operation(text,text)',
             'EXECUTE'
           ) AS authenticated_simple_fail,
           has_function_privilege(
             'service_role',
             'hive.fail_search_operation(text,text)',
             'EXECUTE'
           ) AS service_simple_fail,
           has_function_privilege(
             'authenticated',
             'hive.fail_search_operation_accounted(text,uuid,text)',
             'EXECUTE'
           ) AS authenticated_accounted_fail,
           has_function_privilege(
             'service_role',
             'hive.fail_search_operation_accounted(text,uuid,text)',
             'EXECUTE'
           ) AS service_accounted_fail`,
      );
      assert.deepEqual(baseline.rows[0], {
        migrations: catalog.migrations.length,
        operations_ready: true,
        rls_ready: true,
        start_ready: true,
        simple_complete_ready: true,
        accounted_complete_ready: true,
        fail_ready: true,
        accounted_fail_ready: true,
        authenticated_read: true,
        authenticated_fingerprint: false,
        authenticated_write: false,
        authenticated_start: false,
        service_start: true,
        authenticated_simple_complete: false,
        service_simple_complete: false,
        authenticated_accounted_complete: false,
        service_accounted_complete: true,
        authenticated_simple_fail: false,
        service_simple_fail: true,
        authenticated_accounted_fail: false,
        service_accounted_fail: true,
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
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Native Search Gateway')`,
        [PROJECT_ID, ORGANIZATION_A_ID, REFERENCE_APP_ID, USER_A_ID],
      );

      const database = executor(client);
      const billing = new BillingService(
        new PostgresBillingRepository(database),
        new FakeBillingProvider({ paymentOutcome: 'SUCCESS' }),
      );
      const purchase = await billing.createPurchase(context, {
        projectId: PROJECT_ID,
        productCode: 'REFERENCE_APP_SANDBOX',
        priceId: REFERENCE_PRICE_ID,
        idempotencyKey: 'native-search-gateway-entitlement-0001',
      });

      await client.query('RESET ROLE');
      const usageRepository = new PostgresUsageCostRepository(database);
      const usageCost = new UsageCostService(usageRepository);
      const budget = await usageCost.configureBudget(context, {
        projectId: PROJECT_ID,
        budgetType: 'SEARCH',
        measurementKind: 'COST',
        unitCode: 'USD',
        ceilingAmount: '1',
        cycleId: 'native-search-gateway-cycle',
        idempotencyKey: 'native-search-gateway-budget-0001',
      });

      const fake = new FakeSearchProvider();
      let providerCalls = 0;
      const countedFake = {
        providerCode: fake.providerCode,
        async search(request) {
          providerCalls += 1;
          return fake.search(request);
        },
      };
      const costGuard = new CostGuardService(usageRepository);
      const operationRepository = new PostgresSearchOperationRepository(database);
      const gateway = new SearchGatewayService(createSearchConfiguration(countedFake), {
        trustPolicy: new TrustPolicyService({
          configurationRelease: 'GREEN_HIVE_SEARCH_TRUST_V1',
          policyOverrides: [{
            policyCode: 'REFERENCE_APP_PUBLIC_FAKE_SEARCH',
            classification: 'PUBLIC',
            operation: 'SEARCH_QUERY',
            decision: 'ALLOW',
            providerCode: PROVIDER_CODE,
            confidentialMode: 'ANY',
          }],
        }),
        costGuard,
        operations: operationRepository,
      });

      await assert.rejects(
        operationRepository.start(
          context,
          operationStartInput('native-search-other-app-type-0001', 'OTHER_TEST_APP_FAKE_SEARCH'),
        ),
        hasCode('SEARCH_GATEWAY_INVALID_INPUT'),
      );
      assert.equal((await client.query(
        "SELECT id FROM hive.search_operations WHERE operation_id = 'native-search-other-app-type-0001'",
      )).rows.length, 0);
      await assert.rejects(
        client.query(
          `SELECT hive.start_search_operation(
             $1::uuid, $2::text, $3::text, $4::text, 'PUBLIC',
             $5::text, $6::text, 'ALLOW', NULL, 2, 'NOT_APPLICABLE',
             $7::text, 0.00014, 'USD'
           )`,
          [
            PROJECT_ID,
            'native-search-underscore-namespace-0001',
            'REFERENCEXAPP_FAKE_SEARCH',
            CAPABILITY_CODE,
            PROVIDER_CODE,
            'REFERENCE_APP_PUBLIC_FAKE_SEARCH',
            'b'.repeat(64),
          ],
        ),
        /SEARCH_GATEWAY_INVALID_INPUT/,
      );
      assert.equal((await client.query(
        `SELECT id FROM hive.search_operations
         WHERE operation_id = 'native-search-underscore-namespace-0001'`,
      )).rows.length, 0);

      await assert.rejects(
        gateway.execute(context, {
          ...executeInput('native-search-no-entitlement-0001'),
          budgetId: budget.id,
        }),
        hasCode('SEARCH_GATEWAY_COST_DENIED'),
      );
      assert.equal(providerCalls, 0, 'entitlement denial must happen before the fake provider');

      await billing.processPayment(context, purchase.id);
      const failingGateway = new SearchGatewayService(
        createSearchConfiguration(new FakeSearchProvider({ failureMode: 'UNAVAILABLE' })),
        {
          trustPolicy: new TrustPolicyService({
            configurationRelease: 'GREEN_HIVE_SEARCH_TRUST_V1',
            policyOverrides: [{
              policyCode: 'REFERENCE_APP_PUBLIC_FAKE_SEARCH',
              classification: 'PUBLIC',
              operation: 'SEARCH_QUERY',
              decision: 'ALLOW',
              providerCode: PROVIDER_CODE,
              confidentialMode: 'ANY',
            }],
          }),
          costGuard,
          operations: operationRepository,
        },
      );
      const providerFailureOperationId = 'native-search-provider-failure-0001';
      await assert.rejects(
        failingGateway.execute(context, {
          ...executeInput(providerFailureOperationId),
          budgetId: budget.id,
        }),
        hasCode('SEARCH_GATEWAY_PROVIDER_UNAVAILABLE'),
      );
      assert.deepEqual((await client.query(
        `SELECT operation.status AS operation_status,
                operation.safe_error_code,
                reservation.status AS reservation_status,
                (SELECT count(*)::integer FROM hive.usage_events
                  WHERE operation_id = $1::text) AS usage_events,
                (SELECT count(*)::integer FROM hive.cost_events
                  WHERE operation_id = $1::text) AS cost_events
         FROM hive.search_operations AS operation
         JOIN hive.cost_guard_reservations AS reservation
           ON reservation.operation_id = operation.operation_id
          AND reservation.organization_id = operation.organization_id
          AND reservation.app_id = operation.app_id
          AND reservation.owner_user_id = operation.owner_user_id
         WHERE operation.operation_id = $1::text`,
        [providerFailureOperationId],
      )).rows[0], {
        operation_status: 'FAILED',
        safe_error_code: 'SEARCH_GATEWAY_PROVIDER_UNAVAILABLE',
        reservation_status: 'RELEASED',
        usage_events: 0,
        cost_events: 0,
      });
      const successOperationId = 'native-search-gateway-operation-0001';
      const originalFetch = globalThis.fetch;
      let fetchCalls = 0;
      globalThis.fetch = async () => {
        fetchCalls += 1;
        throw new Error('network access is forbidden in FakeSearchProvider integration tests');
      };
      let result;
      try {
        result = await gateway.execute(context, {
          ...executeInput(successOperationId),
          budgetId: budget.id,
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
      assert.equal(fetchCalls, 0);
      assert.equal(providerCalls, 1);
      assert.equal(result.providerCode, PROVIDER_CODE);
      assert.equal(result.contentTrust, SEARCH_CONTENT_TRUST);
      assert.equal(result.contentTrust, 'UNTRUSTED_EXTERNAL_DATA');
      assert.equal(result.cacheStatus, 'NOT_APPLICABLE');
      assert.deepEqual(result.usage, { requestCount: 1, resultCount: 2 });
      assert.deepEqual(result.cost, {
        reservationId: result.cost.reservationId,
        estimatedAmount: '0.00014',
        actualAmount: '0.00014',
        currency: 'USD',
      });

      const sequentialReplayEvidence = async () => (await client.query(
        `SELECT
           (SELECT count(*)::integer FROM hive.search_operations
             WHERE operation_id = $1::text) AS operations,
           (SELECT count(*)::integer FROM hive.cost_guard_reservations
             WHERE operation_id = $1::text) AS reservations,
           (SELECT count(*)::integer FROM hive.usage_events
             WHERE operation_id = $1::text) AS usage_events,
           (SELECT count(*)::integer FROM hive.cost_events
             WHERE operation_id = $1::text) AS cost_events,
           (SELECT count(*)::integer FROM audit.events
             WHERE project_id = $2::uuid
               AND event_code = 'SEARCH_OPERATION_COMPLETED') AS audit_events`,
        [successOperationId, PROJECT_ID],
      )).rows[0];
      const beforeSequentialReplay = await sequentialReplayEvidence();
      await assert.rejects(
        gateway.execute(context, {
          ...executeInput(successOperationId),
          budgetId: budget.id,
        }),
        hasCode('SEARCH_GATEWAY_OPERATION_CONFLICT'),
      );
      assert.equal(providerCalls, 1);
      assert.deepEqual(await sequentialReplayEvidence(), beforeSequentialReplay);

      const evidence = await client.query(
        `SELECT
           (SELECT count(*)::integer FROM hive.search_operations
             WHERE project_id = $1::uuid AND status = 'SUCCEEDED') AS succeeded_operations,
           (SELECT count(*)::integer FROM hive.search_operations
             WHERE project_id = $1::uuid AND status = 'FAILED') AS failed_operations,
           (SELECT count(*)::integer FROM hive.usage_events
             WHERE project_id = $1::uuid AND usage_code = 'SEARCH_REQUESTS') AS usage_events,
           (SELECT count(*)::integer FROM hive.cost_events
             WHERE project_id = $1::uuid AND service_code = 'SEARCH_GATEWAY') AS cost_events,
           (SELECT count(*)::integer FROM audit.events
             WHERE project_id = $1::uuid
               AND event_code = 'SEARCH_OPERATION_COMPLETED') AS completed_audit_events,
           (SELECT count(*)::integer FROM audit.events
             WHERE project_id = $1::uuid
               AND event_code = 'SEARCH_OPERATION_FAILED') AS failed_audit_events,
           (SELECT count(*)::integer FROM hive.search_operations AS operation
             WHERE operation.project_id = $1::uuid
               AND (
                 to_jsonb(operation)::text ILIKE '%' || $2 || '%'
                 OR to_jsonb(operation)::text ILIKE '%GREEN_HIVE_FAKE_SEARCH_RESULT%'
                 OR to_jsonb(operation)::text ILIKE '%example.invalid%'
               )) AS operation_leaks,
           (SELECT count(*)::integer FROM hive.usage_events AS event
             WHERE event.project_id = $1::uuid
               AND (
                 event.metadata::text ILIKE '%' || $2 || '%'
                 OR event.metadata::text ILIKE '%GREEN_HIVE_FAKE_SEARCH_RESULT%'
                 OR event.metadata::text ILIKE '%example.invalid%'
               )) AS usage_leaks,
           (SELECT count(*)::integer FROM hive.cost_events AS event
             WHERE event.project_id = $1::uuid
               AND (
                 event.metadata::text ILIKE '%' || $2 || '%'
                 OR event.metadata::text ILIKE '%GREEN_HIVE_FAKE_SEARCH_RESULT%'
                 OR event.metadata::text ILIKE '%example.invalid%'
               )) AS cost_leaks,
           (SELECT count(*)::integer FROM audit.events AS event
             WHERE event.project_id = $1::uuid
               AND (
                 event.metadata::text ILIKE '%' || $2 || '%'
                 OR event.metadata::text ILIKE '%GREEN_HIVE_FAKE_SEARCH_RESULT%'
                 OR event.metadata::text ILIKE '%example.invalid%'
               )) AS audit_leaks`,
        [PROJECT_ID, RAW_QUERY_MARKER],
      );
      assert.deepEqual(evidence.rows[0], {
        succeeded_operations: 1,
        failed_operations: 2,
        usage_events: 1,
        cost_events: 1,
        completed_audit_events: 1,
        failed_audit_events: 2,
        operation_leaks: 0,
        usage_leaks: 0,
        cost_leaks: 0,
        audit_leaks: 0,
      });

      const successfulMetadata = await client.query(
        `SELECT
           operation_id,
           status,
           result_count,
           request_count,
           estimated_cost::text,
           actual_cost::text,
           currency,
           cache_status,
           request_fingerprint_sha256
         FROM hive.search_operations
         WHERE project_id = $1::uuid AND operation_id = $2::text`,
        [PROJECT_ID, successOperationId],
      );
      assert.deepEqual(successfulMetadata.rows[0], {
        operation_id: successOperationId,
        status: 'SUCCEEDED',
        result_count: 2,
        request_count: 1,
        estimated_cost: '0.00014000',
        actual_cost: '0.00014000',
        currency: 'USD',
        cache_status: 'NOT_APPLICABLE',
        request_fingerprint_sha256: successfulMetadata.rows[0].request_fingerprint_sha256,
      });
      assert.match(successfulMetadata.rows[0].request_fingerprint_sha256, /^[0-9a-f]{64}$/);
      assert.notEqual(successfulMetadata.rows[0].request_fingerprint_sha256, RAW_QUERY_MARKER);

      await client.query('SET ROLE authenticated');
      await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
      assert.equal((await client.query(
        `SELECT operation_id, status
         FROM hive.search_operations
         WHERE project_id = $1::uuid
         ORDER BY operation_id`,
        [PROJECT_ID],
      )).rows.length, 3);
      await assert.rejects(
        client.query('SELECT request_fingerprint_sha256 FROM hive.search_operations'),
        /permission denied|privilege/i,
      );
      await assert.rejects(
        client.query(
          `SELECT hive.fail_search_operation(
             'native-search-forged-lifecycle-0001', 'SEARCH_GATEWAY_OPERATION_FAILED'
           )`,
        ),
        /permission denied|privilege/i,
      );
      await assert.rejects(
        client.query(
          `SELECT hive.fail_search_operation_accounted(
             $1::text, $2::uuid, 'SEARCH_GATEWAY_OPERATION_FAILED'
           )`,
          [successOperationId, result.cost.reservationId],
        ),
        /permission denied|privilege/i,
      );
      await assert.rejects(
        client.query(
          `SELECT hive.complete_search_operation(
             $1::text, 2, 1, 0.00014, 'NOT_APPLICABLE'
           )`,
          [successOperationId],
        ),
        /permission denied|privilege/i,
      );
      await assert.rejects(
        client.query(
          `SELECT hive.complete_search_operation_accounted(
             $1::text, $2::uuid, 2, 1, 0.00014, 'NOT_APPLICABLE'
           )`,
          [successOperationId, result.cost.reservationId],
        ),
        /permission denied|privilege/i,
      );
      await assert.rejects(
        client.query('UPDATE hive.search_operations SET status = status'),
        /permission denied|privilege/i,
      );
      await assert.rejects(
        client.query('DELETE FROM hive.search_operations'),
        /permission denied|privilege/i,
      );

      await setContext(client, USER_B_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
      assert.equal((await client.query('SELECT id FROM hive.search_operations')).rows.length, 0);
      await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_B_ID);
      assert.equal((await client.query('SELECT id FROM hive.search_operations')).rows.length, 0);
      await setContext(client, USER_A_ID, 'OTHER_TEST_APP', ORGANIZATION_A_ID);
      assert.equal((await client.query('SELECT id FROM hive.search_operations')).rows.length, 0);

      await setContext(client, ADMIN_ID, 'REFERENCE_APP', null, 'PLATFORM_ADMIN');
      assert.equal((await client.query(
        'SELECT id, status FROM hive.search_operations ORDER BY started_at, id',
      )).rows.length, 3);
      await assert.rejects(
        client.query('SELECT request_fingerprint_sha256 FROM hive.search_operations'),
        /permission denied|privilege/i,
      );
      await assert.rejects(
        client.query('UPDATE hive.search_operations SET status = status'),
        /permission denied|privilege/i,
      );
      await assert.rejects(
        client.query('DELETE FROM hive.search_operations'),
        /permission denied|privilege/i,
      );

      await client.query('RESET ROLE');
      await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
      const mismatchOperationId = 'native-search-estimate-mismatch-0001';
      await operationRepository.start(context, operationStartInput(mismatchOperationId));
      const mismatchReservationResult = await costGuard.reserve(context, {
        projectId: PROJECT_ID,
        budgetId: budget.id,
        operationId: mismatchOperationId,
        capabilityCode: CAPABILITY_CODE,
        estimatedAmount: '0.00012',
        currency: 'USD',
        metadata: {
          serviceCode: 'SEARCH_GATEWAY',
          searchType: SEARCH_TYPE,
          providerClass: 'DETERMINISTIC_SEARCH',
        },
      });
      assert.ok(mismatchReservationResult.reservation);
      const mismatchReservationId = mismatchReservationResult.reservation.id;
      await assert.rejects(
        operationRepository.fail(context, {
          operationId: mismatchOperationId,
          errorCode: 'SEARCH_GATEWAY_OPERATION_FAILED',
        }),
        hasCode('SEARCH_GATEWAY_OPERATION_CONFLICT'),
      );
      await assert.rejects(
        operationRepository.complete(context, {
          operationId: mismatchOperationId,
          reservationId: mismatchReservationId,
          resultCount: 1,
          requestCount: 1,
          actualCost: '0.00012',
          cacheStatus: 'NOT_APPLICABLE',
        }),
        hasCode('SEARCH_GATEWAY_INVALID_INPUT'),
      );
      assert.deepEqual((await client.query(
        `SELECT operation.status AS operation_status,
                reservation.status AS reservation_status,
                operation.actual_cost IS NULL AS operation_has_no_actual_cost
         FROM hive.search_operations AS operation
         JOIN hive.cost_guard_reservations AS reservation
           ON reservation.operation_id = operation.operation_id
          AND reservation.organization_id = operation.organization_id
          AND reservation.app_id = operation.app_id
          AND reservation.owner_user_id = operation.owner_user_id
         WHERE operation.operation_id = $1::text`,
        [mismatchOperationId],
      )).rows[0], {
        operation_status: 'PENDING',
        reservation_status: 'RESERVED',
        operation_has_no_actual_cost: true,
      });
      const releaseRollbackOperationId = 'native-search-release-rollback-0001';
      await operationRepository.start(
        context,
        operationStartInput(releaseRollbackOperationId),
      );
      const releaseRollbackReservationResult = await costGuard.reserve(context, {
        projectId: PROJECT_ID,
        budgetId: budget.id,
        operationId: releaseRollbackOperationId,
        capabilityCode: CAPABILITY_CODE,
        estimatedAmount: '0.00014',
        currency: 'USD',
        metadata: {
          serviceCode: 'SEARCH_GATEWAY',
          searchType: SEARCH_TYPE,
          providerClass: 'DETERMINISTIC_SEARCH',
        },
      });
      assert.ok(releaseRollbackReservationResult.reservation);
      const releaseRollbackReservationId = releaseRollbackReservationResult.reservation.id;
      const reservedAmountBeforeInjectedFailure = (await client.query(
        'SELECT reserved_amount::text FROM hive.usage_budgets WHERE id = $1::uuid',
        [budget.id],
      )).rows[0]?.reserved_amount;
      await client.query(`
        CREATE FUNCTION hive.test_reject_search_reservation_release()
        RETURNS trigger
        LANGUAGE plpgsql
        SET search_path = ''
        AS $$
        BEGIN
          IF NEW.id::text = pg_catalog.current_setting(
            'request.green_hive.test_reject_search_reservation_id', true
          ) AND OLD.status = 'RESERVED' AND NEW.status = 'RELEASED' THEN
            RAISE EXCEPTION 'INJECTED_SEARCH_RESERVATION_RELEASE_FAILURE';
          END IF;
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER test_reject_search_reservation_release
        BEFORE UPDATE OF status ON hive.cost_guard_reservations
        FOR EACH ROW EXECUTE FUNCTION hive.test_reject_search_reservation_release();
      `);
      await client.query(
        `SELECT set_config(
           'request.green_hive.test_reject_search_reservation_id', $1, false
         )`,
        [releaseRollbackReservationId],
      );
      try {
        await assert.rejects(
          operationRepository.fail(context, {
            operationId: releaseRollbackOperationId,
            reservationId: releaseRollbackReservationId,
            errorCode: 'SEARCH_GATEWAY_PROVIDER_UNAVAILABLE',
          }),
          hasCode('SEARCH_GATEWAY_OPERATION_FAILED'),
        );
        assert.deepEqual((await client.query(
          `SELECT
             operation.status AS operation_status,
             reservation.status AS reservation_status,
             budget.reserved_amount::text AS budget_reserved_amount
           FROM hive.search_operations AS operation
           JOIN hive.cost_guard_reservations AS reservation
             ON reservation.operation_id = operation.operation_id
            AND reservation.organization_id = operation.organization_id
            AND reservation.app_id = operation.app_id
            AND reservation.owner_user_id = operation.owner_user_id
           JOIN hive.usage_budgets AS budget ON budget.id = reservation.budget_id
           WHERE operation.operation_id = $1::text`,
          [releaseRollbackOperationId],
        )).rows[0], {
          operation_status: 'PENDING',
          reservation_status: 'RESERVED',
          budget_reserved_amount: reservedAmountBeforeInjectedFailure,
        });
      } finally {
        await client.query(`
          DROP TRIGGER test_reject_search_reservation_release
            ON hive.cost_guard_reservations;
          DROP FUNCTION hive.test_reject_search_reservation_release();
        `);
        await client.query(
          `SELECT set_config(
             'request.green_hive.test_reject_search_reservation_id', '', false
           )`,
        );
      }
      await operationRepository.fail(context, {
        operationId: releaseRollbackOperationId,
        reservationId: releaseRollbackReservationId,
        errorCode: 'SEARCH_GATEWAY_PROVIDER_UNAVAILABLE',
      });
      assert.deepEqual((await client.query(
        `SELECT operation.status AS operation_status,
                reservation.status AS reservation_status
         FROM hive.search_operations AS operation
         JOIN hive.cost_guard_reservations AS reservation
           ON reservation.operation_id = operation.operation_id
          AND reservation.organization_id = operation.organization_id
          AND reservation.app_id = operation.app_id
          AND reservation.owner_user_id = operation.owner_user_id
         WHERE operation.operation_id = $1::text`,
        [releaseRollbackOperationId],
      )).rows[0], {
        operation_status: 'FAILED',
        reservation_status: 'RELEASED',
      });

      const atomicOperationId = 'native-search-atomic-rollback-0001';
      await operationRepository.start(context, operationStartInput(atomicOperationId));
      const atomicReservationResult = await costGuard.reserve(context, {
        projectId: PROJECT_ID,
        budgetId: budget.id,
        operationId: atomicOperationId,
        capabilityCode: CAPABILITY_CODE,
        estimatedAmount: '0.00014',
        currency: 'USD',
        metadata: {
          serviceCode: 'SEARCH_GATEWAY',
          searchType: SEARCH_TYPE,
          providerClass: 'DETERMINISTIC_SEARCH',
        },
      });
      assert.ok(atomicReservationResult.reservation);
      const atomicReservationId = atomicReservationResult.reservation.id;
      await usageCost.recordUsage(context, {
        projectId: PROJECT_ID,
        operationId: 'native-search-atomic-conflict-seed-0001',
        idempotencyKey: `search-usage-${atomicReservationId}`,
        eventKind: 'DEBIT',
        usageCode: 'SEARCH_REQUESTS',
        quantity: '3',
        unitCode: 'REQUESTS',
        capabilityCode: CAPABILITY_CODE,
        providerCode: PROVIDER_CODE,
        serviceCode: 'SEARCH_GATEWAY',
        metadata: {
          searchType: SEARCH_TYPE,
          resultCount: 0,
          providerRequestCount: 3,
        },
      });

      await assert.rejects(
        operationRepository.complete(context, {
          operationId: atomicOperationId,
          reservationId: atomicReservationId,
          resultCount: 1,
          requestCount: 1,
          actualCost: '0.00012',
          cacheStatus: 'NOT_APPLICABLE',
        }),
        hasCode('SEARCH_GATEWAY_OPERATION_FAILED'),
      );
      const atomicRollback = (await client.query(
        `SELECT
           (SELECT status FROM hive.search_operations
             WHERE operation_id = $1::text) AS operation_status,
           (SELECT actual_cost IS NULL FROM hive.search_operations
             WHERE operation_id = $1::text) AS operation_has_no_actual_cost,
           (SELECT status FROM hive.cost_guard_reservations
             WHERE id = $2::uuid) AS reservation_status,
           (SELECT count(*)::integer FROM hive.usage_events
             WHERE operation_id = $1::text) AS operation_usage_events,
           (SELECT count(*)::integer FROM hive.cost_events
             WHERE operation_id = $1::text) AS operation_cost_events,
           (SELECT count(*)::integer FROM audit.events
             WHERE project_id = $3::uuid
               AND subject_type = 'SEARCH_OPERATION'
               AND event_code = 'SEARCH_OPERATION_COMPLETED'
               AND subject_id = (
                 SELECT id FROM hive.search_operations WHERE operation_id = $1::text
               )) AS operation_completed_audit_events`,
        [atomicOperationId, atomicReservationId, PROJECT_ID],
      )).rows[0];
      assert.deepEqual(atomicRollback, {
        operation_status: 'PENDING',
        operation_has_no_actual_cost: true,
        reservation_status: 'RESERVED',
        operation_usage_events: 0,
        operation_cost_events: 0,
        operation_completed_audit_events: 0,
      });
      await operationRepository.fail(context, {
        operationId: atomicOperationId,
        reservationId: atomicReservationId,
        errorCode: 'SEARCH_GATEWAY_OPERATION_FAILED',
      });

      const raceOperationId = 'native-search-concurrent-start-0001';
      const raceClientA = new pg.Client({ connectionString: databaseUrl });
      const raceClientB = new pg.Client({ connectionString: databaseUrl });
      await Promise.all([raceClientA.connect(), raceClientB.connect()]);
      try {
        await Promise.all([
          setContext(raceClientA, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID),
          setContext(raceClientB, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID),
        ]);
        const raceRepositoryA = new PostgresSearchOperationRepository(executor(raceClientA));
        const raceRepositoryB = new PostgresSearchOperationRepository(executor(raceClientB));
        const raceOutcomes = await Promise.allSettled([
          raceRepositoryA.start(context, operationStartInput(raceOperationId)),
          raceRepositoryB.start(context, operationStartInput(raceOperationId)),
        ]);
        const raceDiagnostics = raceOutcomes.map((outcome) => (
          outcome.status === 'fulfilled'
            ? { status: outcome.status }
            : {
                status: outcome.status,
                name: outcome.reason?.name,
                code: outcome.reason?.code,
                message: outcome.reason?.message,
              }
        ));
        assert.equal(
          raceOutcomes.filter(({ status }) => status === 'fulfilled').length,
          1,
          JSON.stringify(raceDiagnostics),
        );
        const rejectedRace = raceOutcomes.find(({ status }) => status === 'rejected');
        assert.equal(rejectedRace?.status, 'rejected');
        assert.ok(rejectedRace.reason instanceof SearchGatewayError);
        assert.equal(rejectedRace.reason.code, 'SEARCH_GATEWAY_OPERATION_CONFLICT');
        assert.equal((await client.query(
          'SELECT count(*)::integer AS total FROM hive.search_operations WHERE operation_id = $1',
          [raceOperationId],
        )).rows[0]?.total, 1);
        await raceRepositoryA.fail(context, {
          operationId: raceOperationId,
          errorCode: 'SEARCH_GATEWAY_OPERATION_FAILED',
        });
        assert.equal((await client.query(
          'SELECT status FROM hive.search_operations WHERE operation_id = $1',
          [raceOperationId],
        )).rows[0]?.status, 'FAILED');
      } finally {
        await Promise.all([
          raceClientA.query('RESET ROLE').catch(() => undefined),
          raceClientB.query('RESET ROLE').catch(() => undefined),
        ]);
        await Promise.all([raceClientA.end(), raceClientB.end()]);
      }
    } finally {
      await client.query('RESET ROLE').catch(() => undefined);
      await cleanupGreenHiveFixtures(client).catch(() => undefined);
      await client.end();
    }
  },
);
