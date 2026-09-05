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
  CostGuardService,
  PostgresUsageCostRepository,
  UsageCostService,
} from '../../packages/cost-guard/dist/index.js';
import {
  FakeSearchProvider,
  PostgresSearchOperationRepository,
  SEARCH_CONTENT_TRUST,
  SearchGatewayError,
  SearchGatewayService,
} from '../../packages/search/dist/index.js';
import { TrustPolicyService } from '../../packages/trust/dist/index.js';
import { loadMigrationCatalog } from '../../scripts/lib/migration-catalog.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const USER_A_ID = '10000000-0000-4000-8000-000000000001';
const USER_B_ID = '10000000-0000-4000-8000-000000000002';
const ADMIN_ID = '10000000-0000-4000-8000-000000000003';
const ORGANIZATION_A_ID = '30000000-0000-4000-8000-000000000001';
const REFERENCE_APP_ID = '00000000-0000-4000-8000-000000000001';
const REFERENCE_PRICE_ID = '50000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000122';
const SEARCH_TYPE = 'REFERENCE_APP_WEB_SEARCH';
const SEARCH_CAPABILITY = 'REFERENCE_APP_RUN_JOB';
const RAW_QUERY_MARKER = 'SEARCH_RAW_QUERY_MARKER_0505';
const FAILURE_QUERY_MARKER = 'SEARCH_FAILURE_RAW_MARKER_0505';
const contextA = Object.freeze({
  userId: USER_A_ID,
  appCode: 'REFERENCE_APP',
  organizationId: ORGANIZATION_A_ID,
});

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
  return (error) => error instanceof SearchGatewayError && error.code === code;
}

function abstractQuery(input) {
  return `ABSTRACT_QUERY term_count=${input.trim().split(/\s+/u).length}`;
}

function createSearchConfiguration(provider = new FakeSearchProvider()) {
  return Object.freeze({
    configurationRelease: 'REFERENCE_APP_SEARCH_V1',
    providers: Object.freeze([provider]),
    registrations: Object.freeze([
      Object.freeze({
        providerClass: 'GENERAL_WEB',
        providerCode: provider.providerCode,
        enabled: true,
        priority: 100,
        maxResults: 10,
        requestCost: '0.001',
        resultCost: '0.0001',
        currency: 'BRL',
      }),
    ]),
    tasks: Object.freeze([
      Object.freeze({
        searchType: SEARCH_TYPE,
        sensitivityMax: 'CONFIDENTIAL',
        preferredProviderClass: 'GENERAL_WEB',
        maxQueryCharacters: 1_024,
        maxResults: 2,
        costBudgetType: 'SEARCH',
        cachePolicy: 'NONE',
        retryPolicy: Object.freeze({
          maxAttempts: 1,
          retryableProviderErrors: Object.freeze([]),
        }),
        capabilityCode: SEARCH_CAPABILITY,
        sanitizer: Object.freeze({
          mode: 'ABSTRACT_QUERY',
          sanitize: abstractQuery,
        }),
      }),
    ]),
  });
}

function createGateway(database, usageRepository, provider = new FakeSearchProvider()) {
  return new SearchGatewayService(createSearchConfiguration(provider), {
    trustPolicy: new TrustPolicyService({
      configurationRelease: 'GREEN_HIVE_TRUST_V1',
      policyOverrides: [],
    }),
    costGuard: new CostGuardService(usageRepository),
    operations: new PostgresSearchOperationRepository(executor(database)),
  });
}

function operationStartInput(operationId, searchType = SEARCH_TYPE) {
  return {
    projectId: PROJECT_ID,
    operationId,
    searchType,
    capabilityCode: SEARCH_CAPABILITY,
    classification: 'CONFIDENTIAL',
    providerCode: 'GREEN_HIVE_FAKE_SEARCH',
    trustPolicyCode: 'TRUST_CONF_SEARCH',
    trustDecision: 'ALLOW_WITH_SANITIZATION',
    sanitizationMode: 'ABSTRACT_QUERY',
    maxResults: 2,
    cacheStatus: 'NOT_APPLICABLE',
    estimatedCost: '0.0012',
    currency: 'BRL',
    requestFingerprint: 'a'.repeat(64),
  };
}

test('GH-0505 executes a deterministic tenant-safe Search operation with accounting, Audit and RLS evidence', async () => {
  const database = new PGlite({ extensions: { pgcrypto } });
  await database.waitReady;
  try {
    await prepare(database);
    await database.exec('SET ROLE authenticated;');
    await setContext(database, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    await database.query(
      `INSERT INTO hive.projects (id, organization_id, app_id, owner_user_id, name)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Search Gateway Foundation')`,
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
      idempotencyKey: 'search-gateway-entitlement-0001',
    });
    await database.exec('RESET ROLE;');
    await billing.processPayment(contextA, purchase.id);

    const usageRepository = new PostgresUsageCostRepository(db);
    const usageCost = new UsageCostService(usageRepository);
    const budget = await usageCost.configureBudget(contextA, {
      projectId: PROJECT_ID,
      budgetType: 'SEARCH',
      measurementKind: 'COST',
      unitCode: 'BRL',
      ceilingAmount: '1',
      cycleId: 'cycle-search-gateway-001',
      idempotencyKey: 'search-gateway-budget-0001',
    });
    const gateway = createGateway(database, usageRepository);
    const operationRepository = new PostgresSearchOperationRepository(db);
    const costGuard = new CostGuardService(usageRepository);

    await assert.rejects(
      operationRepository.start(
        contextA,
        operationStartInput('search-other-app-type-0001', 'OTHER_TEST_APP_WEB_SEARCH'),
      ),
      hasCode('SEARCH_GATEWAY_INVALID_INPUT'),
    );
    assert.equal((await database.query(
      "SELECT id FROM hive.search_operations WHERE operation_id = 'search-other-app-type-0001'",
    )).rows.length, 0);
    await assert.rejects(
      database.query(
        `SELECT hive.start_search_operation(
           $1::uuid, $2::text, $3::text, $4::text, 'CONFIDENTIAL',
           'GREEN_HIVE_FAKE_SEARCH', 'TRUST_CONF_SEARCH',
           'ALLOW_WITH_SANITIZATION', 'ABSTRACT_QUERY', 2, 'NOT_APPLICABLE',
           $5::text, 0.0012, 'BRL'
         )`,
        [
          PROJECT_ID,
          'search-underscore-namespace-0001',
          'REFERENCEXAPP_WEB_SEARCH',
          SEARCH_CAPABILITY,
          'b'.repeat(64),
        ],
      ),
      /SEARCH_GATEWAY_INVALID_INPUT/,
    );
    assert.equal((await database.query(
      "SELECT id FROM hive.search_operations WHERE operation_id = 'search-underscore-namespace-0001'",
    )).rows.length, 0);

    await assert.rejects(
      gateway.execute({ ...contextA, userId: USER_B_ID }, {
        projectId: PROJECT_ID,
        budgetId: budget.id,
        operationId: 'search-forged-user-0001',
        searchType: SEARCH_TYPE,
        query: 'forged cross-user query',
        classification: 'CONFIDENTIAL',
      }),
      hasCode('SEARCH_GATEWAY_ACCESS_DENIED'),
    );
    await assert.rejects(
      gateway.execute({ ...contextA, appCode: 'OTHER_TEST_APP' }, {
        projectId: PROJECT_ID,
        budgetId: budget.id,
        operationId: 'search-forged-app-0001',
        searchType: SEARCH_TYPE,
        query: 'forged cross-app query',
        classification: 'CONFIDENTIAL',
      }),
      hasCode('SEARCH_GATEWAY_ACCESS_DENIED'),
    );
    await assert.rejects(
      gateway.execute({ ...contextA, platformRole: 'PLATFORM_ADMIN' }, {
        projectId: PROJECT_ID,
        budgetId: budget.id,
        operationId: 'search-forged-admin-0001',
        searchType: SEARCH_TYPE,
        query: 'admin write attempt',
        classification: 'CONFIDENTIAL',
      }),
      hasCode('SEARCH_GATEWAY_ACCESS_DENIED'),
    );
    assert.equal((await database.query(
      `SELECT id FROM hive.search_operations
       WHERE operation_id IN (
         'search-forged-user-0001', 'search-forged-app-0001', 'search-forged-admin-0001'
       )`,
    )).rows.length, 0);

    const result = await gateway.execute(contextA, {
      projectId: PROJECT_ID,
      budgetId: budget.id,
      operationId: 'search-gateway-database-0001',
      searchType: SEARCH_TYPE,
      query: `${RAW_QUERY_MARKER} private customer research must remain data`,
      classification: 'CONFIDENTIAL',
    });
    assert.equal(result.providerCode, 'GREEN_HIVE_FAKE_SEARCH');
    assert.equal(result.contentTrust, SEARCH_CONTENT_TRUST);
    assert.equal(result.cacheStatus, 'NOT_APPLICABLE');
    assert.equal(result.trust.decision, 'ALLOW_WITH_SANITIZATION');
    assert.equal(result.trust.sanitizationMode, 'ABSTRACT_QUERY');
    assert.equal(result.results.length, 2);
    assert.deepEqual(result.usage, { requestCount: 1, resultCount: 2 });
    assert.deepEqual(result.cost, {
      reservationId: result.cost.reservationId,
      estimatedAmount: '0.0012',
      actualAmount: '0.0012',
      currency: 'BRL',
    });
    assert.equal(JSON.stringify(result).includes(RAW_QUERY_MARKER), false);

    const sequentialReplayEvidence = async () => (await database.query(
      `SELECT
         (SELECT count(*)::integer FROM hive.search_operations
           WHERE operation_id = 'search-gateway-database-0001') AS operations,
         (SELECT count(*)::integer FROM hive.cost_guard_reservations
           WHERE operation_id = 'search-gateway-database-0001') AS reservations,
         (SELECT count(*)::integer FROM hive.usage_events
           WHERE operation_id = 'search-gateway-database-0001') AS usage_events,
         (SELECT count(*)::integer FROM hive.cost_events
           WHERE operation_id = 'search-gateway-database-0001') AS cost_events,
         (SELECT count(*)::integer FROM audit.events
           WHERE project_id = $1::uuid
             AND event_code = 'SEARCH_OPERATION_COMPLETED') AS audit_events`,
      [PROJECT_ID],
    )).rows[0];
    const beforeSequentialReplay = await sequentialReplayEvidence();
    await assert.rejects(
      gateway.execute(contextA, {
        projectId: PROJECT_ID,
        budgetId: budget.id,
        operationId: 'search-gateway-database-0001',
        searchType: SEARCH_TYPE,
        query: `${RAW_QUERY_MARKER} repeated operation identity`,
        classification: 'CONFIDENTIAL',
      }),
      hasCode('SEARCH_GATEWAY_OPERATION_CONFLICT'),
    );
    assert.deepEqual(await sequentialReplayEvidence(), beforeSequentialReplay);

    await database.exec('RESET ROLE;');
    const evidence = await database.query(
      `SELECT
         (SELECT count(*)::integer FROM hive.search_operations
           WHERE project_id = $1::uuid AND status = 'SUCCEEDED') AS operations,
         (SELECT count(*)::integer FROM hive.usage_events
           WHERE project_id = $1::uuid AND usage_code = 'SEARCH_REQUESTS') AS usage_events,
         (SELECT count(*)::integer FROM hive.cost_events
           WHERE project_id = $1::uuid AND service_code = 'SEARCH_GATEWAY') AS cost_events,
         (SELECT count(*)::integer FROM audit.events
           WHERE project_id = $1::uuid AND event_code = 'SEARCH_OPERATION_COMPLETED') AS audit_events,
         (SELECT count(*)::integer FROM hive.search_operations AS operation
           WHERE row_to_json(operation)::text LIKE '%' || $2 || '%') AS leaked_operations,
         (SELECT count(*)::integer FROM audit.events
           WHERE metadata::text LIKE '%' || $2 || '%') AS leaked_audit`,
      [PROJECT_ID, RAW_QUERY_MARKER],
    );
    assert.deepEqual(evidence.rows[0], {
      operations: 1,
      usage_events: 1,
      cost_events: 1,
      audit_events: 1,
      leaked_operations: 0,
      leaked_audit: 0,
    });

    const stored = (await database.query(
      `SELECT search_type, capability_code, classification, provider_code,
              trust_policy_code, trust_decision, sanitization_mode, max_results,
              cache_status, status, result_count, request_count,
              estimated_cost::text, actual_cost::text, currency, safe_error_code
       FROM hive.search_operations
       WHERE operation_id = 'search-gateway-database-0001'`,
    )).rows[0];
    assert.deepEqual(stored, {
      search_type: SEARCH_TYPE,
      capability_code: SEARCH_CAPABILITY,
      classification: 'CONFIDENTIAL',
      provider_code: 'GREEN_HIVE_FAKE_SEARCH',
      trust_policy_code: 'TRUST_CONF_SEARCH',
      trust_decision: 'ALLOW_WITH_SANITIZATION',
      sanitization_mode: 'ABSTRACT_QUERY',
      max_results: 2,
      cache_status: 'NOT_APPLICABLE',
      status: 'SUCCEEDED',
      result_count: 2,
      request_count: 1,
      estimated_cost: '0.00120000',
      actual_cost: '0.00120000',
      currency: 'BRL',
      safe_error_code: null,
    });
    const accounting = (await database.query(
      `SELECT
         (SELECT quantity::text FROM hive.usage_events
           WHERE operation_id = 'search-gateway-database-0001') AS usage_quantity,
         (SELECT amount::text FROM hive.cost_events
           WHERE operation_id = 'search-gateway-database-0001') AS cost_amount,
         (SELECT status FROM hive.cost_guard_reservations
           WHERE operation_id = 'search-gateway-database-0001') AS reservation_status`,
    )).rows[0];
    assert.deepEqual(accounting, {
      usage_quantity: '1.00000000',
      cost_amount: '0.00120000',
      reservation_status: 'CONSUMED',
    });
    const prohibitedColumns = await database.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'hive' AND table_name = 'search_operations'
         AND column_name ~* '^(query|url|snippet|raw|raw_content|content|response|result|results)$'`,
    );
    assert.deepEqual(prohibitedColumns.rows, []);

    const privileges = (await database.query(
      `SELECT
         to_regprocedure(
           'hive.complete_search_operation(text,integer,integer,numeric,text)'
         ) IS NOT NULL AS simple_complete_ready,
         to_regprocedure(
           'hive.complete_search_operation_accounted(text,uuid,integer,integer,numeric,text)'
         ) IS NOT NULL AS accounted_complete_ready,
         has_table_privilege('authenticated', 'hive.search_operations', 'SELECT')
           AS authenticated_table_select,
         has_any_column_privilege('authenticated', 'hive.search_operations', 'SELECT')
           AS authenticated_column_select,
         has_table_privilege('authenticated', 'hive.search_operations', 'INSERT')
           AS authenticated_insert,
         has_table_privilege('authenticated', 'hive.search_operations', 'UPDATE')
           AS authenticated_update,
         has_table_privilege('authenticated', 'hive.search_operations', 'DELETE')
           AS authenticated_delete,
         has_column_privilege(
           'authenticated', 'hive.search_operations', 'request_fingerprint_sha256', 'SELECT'
         ) AS authenticated_fingerprint_select,
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
         ) AS authenticated_complete,
         has_function_privilege(
           'service_role',
           'hive.complete_search_operation(text,integer,integer,numeric,text)',
           'EXECUTE'
         ) AS service_complete,
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
         to_regprocedure(
           'hive.fail_search_operation_accounted(text,uuid,text)'
         ) IS NOT NULL AS accounted_fail_ready,
         has_function_privilege(
           'authenticated', 'hive.fail_search_operation(text,text)', 'EXECUTE'
         ) AS authenticated_fail,
         has_function_privilege(
           'service_role', 'hive.fail_search_operation(text,text)', 'EXECUTE'
         ) AS service_fail,
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
    )).rows[0];
    assert.deepEqual(privileges, {
      simple_complete_ready: true,
      accounted_complete_ready: true,
      authenticated_table_select: false,
      authenticated_column_select: true,
      authenticated_insert: false,
      authenticated_update: false,
      authenticated_delete: false,
      authenticated_fingerprint_select: false,
      authenticated_start: false,
      service_start: true,
      authenticated_complete: false,
      service_complete: false,
      authenticated_accounted_complete: false,
      service_accounted_complete: true,
      accounted_fail_ready: true,
      authenticated_fail: false,
      service_fail: true,
      authenticated_accounted_fail: false,
      service_accounted_fail: true,
    });

    await database.exec('SET ROLE authenticated;');
    await setContext(database, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    assert.equal((await database.query(
      'SELECT operation_id, status FROM hive.search_operations WHERE project_id = $1::uuid',
      [PROJECT_ID],
    )).rows.length, 1);
    await assert.rejects(
      database.query('SELECT request_fingerprint_sha256 FROM hive.search_operations'),
      /permission denied|privilege/i,
    );
    for (const statement of [
      'INSERT INTO hive.search_operations DEFAULT VALUES',
      "UPDATE hive.search_operations SET status = 'FAILED'",
      'DELETE FROM hive.search_operations',
      `SELECT hive.start_search_operation(
         '${PROJECT_ID}'::uuid, 'browser-search-forged-0001', '${SEARCH_TYPE}',
         '${SEARCH_CAPABILITY}', 'CONFIDENTIAL', 'GREEN_HIVE_FAKE_SEARCH',
         'TRUST_CONF_SEARCH', 'ALLOW_WITH_SANITIZATION', 'ABSTRACT_QUERY',
         2, 'NOT_APPLICABLE', '${'a'.repeat(64)}', 1, 'BRL'
       )`,
      `SELECT hive.complete_search_operation(
         'search-gateway-database-0001', 2, 1, 0.0012, 'NOT_APPLICABLE'
       )`,
      `SELECT hive.complete_search_operation_accounted(
         'search-gateway-database-0001', '${result.cost.reservationId}'::uuid,
         2, 1, 0.0012, 'NOT_APPLICABLE'
       )`,
      `SELECT hive.fail_search_operation_accounted(
         'search-gateway-database-0001', '${result.cost.reservationId}'::uuid,
         'SEARCH_GATEWAY_OPERATION_FAILED'
       )`,
    ]) {
      await assert.rejects(database.query(statement), /permission denied|privilege/i);
    }

    await setContext(database, USER_B_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    assert.equal((await database.query('SELECT id FROM hive.search_operations')).rows.length, 0);
    await setContext(database, USER_A_ID, 'OTHER_TEST_APP', ORGANIZATION_A_ID);
    assert.equal((await database.query('SELECT id FROM hive.search_operations')).rows.length, 0);
    await setContext(database, ADMIN_ID, 'REFERENCE_APP', null, 'PLATFORM_ADMIN');
    assert.equal((await database.query('SELECT id, status FROM hive.search_operations')).rows.length, 1);
    await assert.rejects(
      database.query('DELETE FROM hive.search_operations'),
      /permission denied|privilege/i,
    );

    await database.exec('RESET ROLE;');
    await setContext(database, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    const failingGateway = createGateway(
      database,
      usageRepository,
      new FakeSearchProvider({ failureMode: 'UNAVAILABLE' }),
    );
    await assert.rejects(
      failingGateway.execute(contextA, {
        projectId: PROJECT_ID,
        budgetId: budget.id,
        operationId: 'search-gateway-failure-0001',
        searchType: SEARCH_TYPE,
        query: `${FAILURE_QUERY_MARKER} unavailable provider input`,
        classification: 'CONFIDENTIAL',
      }),
      hasCode('SEARCH_GATEWAY_PROVIDER_UNAVAILABLE'),
    );
    const failed = (await database.query(
      `SELECT status, result_count, request_count, actual_cost::text, safe_error_code
       FROM hive.search_operations
       WHERE operation_id = 'search-gateway-failure-0001'`,
    )).rows[0];
    assert.deepEqual(failed, {
      status: 'FAILED',
      result_count: null,
      request_count: null,
      actual_cost: null,
      safe_error_code: 'SEARCH_GATEWAY_PROVIDER_UNAVAILABLE',
    });
    assert.equal((await database.query(
      `SELECT status FROM hive.cost_guard_reservations
       WHERE operation_id = 'search-gateway-failure-0001'`,
    )).rows[0]?.status, 'RELEASED');
    assert.equal((await database.query(
      `SELECT id FROM hive.usage_events
       WHERE operation_id = 'search-gateway-failure-0001'`,
    )).rows.length, 0);
    assert.equal((await database.query(
      `SELECT id FROM hive.cost_events
       WHERE operation_id = 'search-gateway-failure-0001'`,
    )).rows.length, 0);
    assert.equal((await database.query(
      `SELECT id FROM audit.events
       WHERE project_id = $1::uuid
         AND event_code = 'SEARCH_OPERATION_FAILED'
         AND metadata ->> 'safe_error_code' = 'SEARCH_GATEWAY_PROVIDER_UNAVAILABLE'`,
      [PROJECT_ID],
    )).rows.length, 1);
    assert.equal((await database.query(
      `SELECT count(*)::integer AS leaked
       FROM hive.search_operations AS operation
       WHERE row_to_json(operation)::text LIKE '%' || $1 || '%'`,
      [FAILURE_QUERY_MARKER],
    )).rows[0]?.leaked, 0);
    assert.equal((await database.query(
      `SELECT count(*)::integer AS leaked
       FROM audit.events WHERE metadata::text LIKE '%' || $1 || '%'`,
      [FAILURE_QUERY_MARKER],
    )).rows[0]?.leaked, 0);

    const mismatchOperationId = 'search-estimate-mismatch-0001';
    await operationRepository.start(contextA, operationStartInput(mismatchOperationId));
    const mismatchReservationResult = await costGuard.reserve(contextA, {
      projectId: PROJECT_ID,
      budgetId: budget.id,
      operationId: mismatchOperationId,
      capabilityCode: SEARCH_CAPABILITY,
      estimatedAmount: '0.0011',
      currency: 'BRL',
      metadata: {
        serviceCode: 'SEARCH_GATEWAY',
        searchType: SEARCH_TYPE,
        providerClass: 'GENERAL_WEB',
      },
    });
    assert.ok(mismatchReservationResult.reservation);
    const mismatchReservationId = mismatchReservationResult.reservation.id;
    await assert.rejects(
      operationRepository.fail(contextA, {
        operationId: mismatchOperationId,
        errorCode: 'SEARCH_GATEWAY_OPERATION_FAILED',
      }),
      hasCode('SEARCH_GATEWAY_OPERATION_CONFLICT'),
    );
    await assert.rejects(
      operationRepository.complete(contextA, {
        operationId: mismatchOperationId,
        reservationId: mismatchReservationId,
        resultCount: 1,
        requestCount: 1,
        actualCost: '0.0011',
        cacheStatus: 'NOT_APPLICABLE',
      }),
      hasCode('SEARCH_GATEWAY_INVALID_INPUT'),
    );
    assert.deepEqual((await database.query(
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
    const releaseRollbackOperationId = 'search-release-rollback-0001';
    await operationRepository.start(
      contextA,
      operationStartInput(releaseRollbackOperationId),
    );
    const releaseRollbackReservationResult = await costGuard.reserve(contextA, {
      projectId: PROJECT_ID,
      budgetId: budget.id,
      operationId: releaseRollbackOperationId,
      capabilityCode: SEARCH_CAPABILITY,
      estimatedAmount: '0.0012',
      currency: 'BRL',
      metadata: {
        serviceCode: 'SEARCH_GATEWAY',
        searchType: SEARCH_TYPE,
        providerClass: 'GENERAL_WEB',
      },
    });
    assert.ok(releaseRollbackReservationResult.reservation);
    const releaseRollbackReservationId = releaseRollbackReservationResult.reservation.id;
    const reservedAmountBeforeInjectedFailure = (await database.query(
      'SELECT reserved_amount::text FROM hive.usage_budgets WHERE id = $1::uuid',
      [budget.id],
    )).rows[0]?.reserved_amount;
    await database.exec(`
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
    await database.query(
      `SELECT set_config(
         'request.green_hive.test_reject_search_reservation_id', $1, false
       )`,
      [releaseRollbackReservationId],
    );
    try {
      await assert.rejects(
        operationRepository.fail(contextA, {
          operationId: releaseRollbackOperationId,
          reservationId: releaseRollbackReservationId,
          errorCode: 'SEARCH_GATEWAY_PROVIDER_UNAVAILABLE',
        }),
        hasCode('SEARCH_GATEWAY_OPERATION_FAILED'),
      );
      assert.deepEqual((await database.query(
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
      await database.exec(`
        DROP TRIGGER test_reject_search_reservation_release
          ON hive.cost_guard_reservations;
        DROP FUNCTION hive.test_reject_search_reservation_release();
      `);
      await database.query(
        `SELECT set_config(
           'request.green_hive.test_reject_search_reservation_id', '', false
         )`,
      );
    }
    await operationRepository.fail(contextA, {
      operationId: releaseRollbackOperationId,
      reservationId: releaseRollbackReservationId,
      errorCode: 'SEARCH_GATEWAY_PROVIDER_UNAVAILABLE',
    });
    assert.deepEqual((await database.query(
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

    const atomicOperationId = 'search-atomic-accounted-rollback-0001';
    await operationRepository.start(contextA, operationStartInput(atomicOperationId));
    const atomicReservationResult = await costGuard.reserve(contextA, {
      projectId: PROJECT_ID,
      budgetId: budget.id,
      operationId: atomicOperationId,
      capabilityCode: SEARCH_CAPABILITY,
      estimatedAmount: '0.0012',
      currency: 'BRL',
      metadata: {
        serviceCode: 'SEARCH_GATEWAY',
        searchType: SEARCH_TYPE,
        providerClass: 'GENERAL_WEB',
      },
    });
    assert.ok(atomicReservationResult.reservation);
    const atomicReservationId = atomicReservationResult.reservation.id;
    await usageCost.recordUsage(contextA, {
      projectId: PROJECT_ID,
      operationId: 'search-atomic-conflict-seed-0001',
      idempotencyKey: `search-usage-${atomicReservationId}`,
      eventKind: 'DEBIT',
      usageCode: 'SEARCH_REQUESTS',
      quantity: '3',
      unitCode: 'REQUESTS',
      capabilityCode: SEARCH_CAPABILITY,
      providerCode: 'GREEN_HIVE_FAKE_SEARCH',
      serviceCode: 'SEARCH_GATEWAY',
      metadata: {
        searchType: SEARCH_TYPE,
        resultCount: 0,
        providerRequestCount: 3,
      },
    });

    await assert.rejects(
      operationRepository.complete(contextA, {
        operationId: atomicOperationId,
        reservationId: atomicReservationId,
        resultCount: 1,
        requestCount: 1,
        actualCost: '0.0011',
        cacheStatus: 'NOT_APPLICABLE',
      }),
      hasCode('SEARCH_GATEWAY_OPERATION_FAILED'),
    );
    const atomicRollback = (await database.query(
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
    await operationRepository.fail(contextA, {
      operationId: atomicOperationId,
      reservationId: atomicReservationId,
      errorCode: 'SEARCH_GATEWAY_OPERATION_FAILED',
    });
  } finally {
    await database.close();
  }
});
