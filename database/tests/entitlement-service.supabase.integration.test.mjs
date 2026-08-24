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
  EntitlementError,
  EntitlementService,
  PostgresEntitlementRepository,
} from '../../packages/entitlements/dist/index.js';
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
  REFERENCE_PRICE_ID,
  SHARED_ORGANIZATION_ID,
  USER_A_ID,
  USER_B_ID,
} from './helpers/rls-matrix.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const databaseUrl = process.env.GREEN_HIVE_TEST_DATABASE_URL;
const confirmation = process.env.GREEN_HIVE_TEST_CONFIRM;
const target = process.env.GREEN_HIVE_TEST_TARGET;
const isStaging = target === SUPABASE_STAGING_TARGET;
const PROJECT_ID = '20000000-0000-4000-8000-000000000106';

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
  return (error) => error instanceof EntitlementError && error.code === code;
}

test(
  'GH-0304 Entitlements grant and can boundary on native Supabase',
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
    const executor = { query: (sql, parameters) => client.query(sql, parameters) };
    const billing = new BillingService(
      new PostgresBillingRepository(executor),
      new FakeBillingProvider({ paymentOutcome: 'SUCCESS' }),
    );
    const entitlements = new EntitlementService(new PostgresEntitlementRepository(executor));
    let firstPurchase;
    let secondPurchase;

    try {
      await assertNativeSupabaseContract(client);
      const catalog = await loadMigrationCatalog(repositoryRoot);
      const baseline = await client.query(
        `SELECT
           (SELECT count(*)::integer FROM hive.schema_migrations) AS migrations,
           (SELECT count(*)::integer
              FROM hive.product_entitlement_capabilities
             WHERE product_id = '40000000-0000-4000-8000-000000000001'::uuid
               AND active) AS capability_mappings,
           to_regprocedure('hive.can_project_capability(uuid,text)') IS NOT NULL AS can_ready`,
      );
      assert.deepEqual(baseline.rows[0], {
        migrations: catalog.migrations.length,
        capability_mappings: 2,
        can_ready: true,
      });

      await cleanupGreenHiveFixtures(client);
      const fixture = await readFile(
        path.join(repositoryRoot, 'database', 'tests', 'fixtures', '0001_rls_identities.sql'),
        'utf8',
      );
      await client.query(fixture);
      await client.query('SET ROLE authenticated');
      await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
      await client.query(
        `INSERT INTO hive.projects (id, organization_id, app_id, owner_user_id, name)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Native Entitlement Project')`,
        [PROJECT_ID, ORGANIZATION_A_ID, REFERENCE_APP_ID, USER_A_ID],
      );

      await testContext.test('pending purchase grants no capability and clients cannot self-grant', async () => {
        firstPurchase = await billing.createPurchase(contextA, {
          projectId: PROJECT_ID,
          productCode: 'REFERENCE_APP_SANDBOX',
          priceId: REFERENCE_PRICE_ID,
          idempotencyKey: 'native-entitlement-0001',
        });
        assert.equal(await entitlements.can(contextA, PROJECT_ID, 'REFERENCE_APP_RUN_JOB'), false);
        assert.deepEqual(await entitlements.list(contextA, PROJECT_ID), []);
        await assert.rejects(
          client.query('SELECT hive.apply_entitlement_state_for_purchase($1::uuid)', [firstPurchase.id]),
          /permission denied|privilege/i,
        );
        await assert.rejects(
          client.query("UPDATE hive.project_entitlements SET status = 'ACTIVE'"),
          /permission denied|privilege/i,
        );
      });

      await testContext.test('paid purchase grants both manifest capabilities once', async () => {
        await client.query('RESET ROLE');
        await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
        await billing.processPayment(contextA, firstPurchase.id);
        await billing.processPayment(contextA, firstPurchase.id);
        await client.query('SET ROLE authenticated');
        await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);

        assert.equal(await entitlements.can(contextA, PROJECT_ID, 'REFERENCE_APP_RUN_JOB'), true);
        assert.equal(await entitlements.can(contextA, PROJECT_ID, 'REFERENCE_APP_GENERATE_FILE'), true);
        assert.equal(await entitlements.can(contextA, PROJECT_ID, 'REFERENCE_APP_UNKNOWN'), false);
        const grants = await entitlements.list(contextA, PROJECT_ID);
        assert.equal(grants.length, 2);
        assert.ok(grants.every((grant) => grant.status === 'ACTIVE'));
      });

      await testContext.test('independent purchases keep capability active until all are refunded', async () => {
        secondPurchase = await billing.createPurchase(contextA, {
          projectId: PROJECT_ID,
          productCode: 'REFERENCE_APP_SANDBOX',
          priceId: REFERENCE_PRICE_ID,
          idempotencyKey: 'native-entitlement-0002',
        });
        await client.query('RESET ROLE');
        await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
        await billing.processPayment(contextA, secondPurchase.id);
        await billing.refundPayment(contextA, firstPurchase.id);
        await client.query('SET ROLE authenticated');
        await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
        assert.equal(await entitlements.can(contextA, PROJECT_ID, 'REFERENCE_APP_RUN_JOB'), true);

        await client.query('RESET ROLE');
        await billing.refundPayment(contextA, secondPurchase.id);
        await client.query('SET ROLE authenticated');
        await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
        assert.equal(await entitlements.can(contextA, PROJECT_ID, 'REFERENCE_APP_RUN_JOB'), false);
        const snapshots = await entitlements.list(contextA, PROJECT_ID);
        assert.equal(snapshots.length, 4);
        assert.ok(snapshots.every((grant) => grant.status === 'REVOKED'));
      });

      await testContext.test('decisions do not cross user, workspace or app scope', async () => {
        await setContext(client, USER_B_ID, 'REFERENCE_APP', ORGANIZATION_B_ID);
        assert.equal(
          await entitlements.can(
            { userId: USER_B_ID, appCode: 'REFERENCE_APP', organizationId: ORGANIZATION_B_ID },
            PROJECT_ID,
            'REFERENCE_APP_RUN_JOB',
          ),
          false,
        );

        await setContext(client, USER_A_ID, 'REFERENCE_APP', SHARED_ORGANIZATION_ID);
        assert.equal(
          await entitlements.can(
            { ...contextA, organizationId: SHARED_ORGANIZATION_ID },
            PROJECT_ID,
            'REFERENCE_APP_RUN_JOB',
          ),
          false,
        );

        await setContext(client, USER_A_ID, 'OTHER_TEST_APP', ORGANIZATION_A_ID);
        assert.equal(
          await entitlements.can(
            { ...contextA, appCode: 'OTHER_TEST_APP' },
            PROJECT_ID,
            'OTHER_TEST_APP_RUN_JOB',
          ),
          false,
        );
      });

      await testContext.test('admin inspects snapshots but cannot reuse owner service commands', async () => {
        await setContext(client, ADMIN_ID, 'REFERENCE_APP', null, 'PLATFORM_ADMIN');
        assert.equal((await client.query('SELECT id FROM hive.project_entitlements')).rows.length, 4);
        await assert.rejects(
          entitlements.list({ ...contextA, platformRole: 'PLATFORM_ADMIN' }, PROJECT_ID),
          hasCode('ENTITLEMENT_ACCESS_DENIED'),
        );
      });

      await client.query('RESET ROLE');
      const audit = await client.query(
        `SELECT event_code, count(*)::integer AS occurrences
         FROM audit.events
         WHERE subject_type = 'ENTITLEMENT' AND project_id = $1::uuid
         GROUP BY event_code
         ORDER BY event_code`,
        [PROJECT_ID],
      );
      assert.deepEqual(audit.rows, [
        { event_code: 'ENTITLEMENT_CHANGED', occurrences: 4 },
        { event_code: 'ENTITLEMENT_GRANTED', occurrences: 4 },
      ]);
    } finally {
      await cleanupGreenHiveFixtures(client).catch(() => undefined);
      await client.end();
    }
  },
);
