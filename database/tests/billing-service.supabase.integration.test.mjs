import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import pg from 'pg';
import {
  BillingError,
  BillingService,
  PostgresBillingRepository,
} from '../../packages/billing/dist/index.js';
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
const PROJECT_A_ID = '20000000-0000-4000-8000-000000000101';
const PROJECT_A_SECOND_ID = '20000000-0000-4000-8000-000000000102';

const contextA = {
  userId: USER_A_ID,
  appCode: 'REFERENCE_APP',
  organizationId: ORGANIZATION_A_ID,
};
const contextB = {
  userId: USER_B_ID,
  appCode: 'REFERENCE_APP',
  organizationId: ORGANIZATION_B_ID,
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
  return (error) => error instanceof BillingError && error.code === code;
}

test(
  'GH-0301 Billing Service on native Supabase',
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
    const service = new BillingService(
      new PostgresBillingRepository({
        query: (sql, parameters) => client.query(sql, parameters),
      }),
    );
    let purchase;

    try {
      await assertNativeSupabaseContract(client);
      const migrationCatalog = await loadMigrationCatalog(repositoryRoot);
      const baseline = await client.query(
        `SELECT
           (SELECT count(*)::integer FROM hive.schema_migrations) AS migrations,
           (SELECT count(*)::integer FROM hive.products WHERE product_code = 'REFERENCE_APP_SANDBOX') AS products,
           (SELECT count(*)::integer FROM hive.prices WHERE id = $1::uuid) AS prices`,
        [REFERENCE_PRICE_ID],
      );
      assert.deepEqual(baseline.rows[0], {
        migrations: migrationCatalog.migrations.length,
        products: 1,
        prices: 1,
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
         VALUES
           ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Native Billing Project'),
           ($5::uuid, $2::uuid, $3::uuid, $4::uuid, 'Native Billing Project Two')`,
        [
          PROJECT_A_ID,
          ORGANIZATION_A_ID,
          REFERENCE_APP_ID,
          USER_A_ID,
          PROJECT_A_SECOND_ID,
        ],
      );

      await testContext.test('catalog exposes only the current app and exact decimal prices', async () => {
        const catalog = await service.listCatalog(contextA);
        assert.deepEqual(catalog.map((product) => product.productCode), ['REFERENCE_APP_SANDBOX']);
        assert.equal(catalog[0].prices[0].amount, '0.000000');
        assert.equal(catalog[0].prices[0].currency, 'BRL');
      });

      await testContext.test('pending purchase and payment are atomic and idempotent', async () => {
        const input = {
          projectId: PROJECT_A_ID,
          productCode: 'REFERENCE_APP_SANDBOX',
          priceId: REFERENCE_PRICE_ID,
          idempotencyKey: 'native-billing-0001',
        };
        purchase = await service.createPurchase(contextA, input);
        const repeated = await service.createPurchase(contextA, input);
        assert.equal(repeated.id, purchase.id);
        assert.equal(repeated.payment.id, purchase.payment.id);
        assert.equal(purchase.status, 'PENDING');
        assert.equal(purchase.payment.status, 'PENDING');
        assert.equal(purchase.amount, '0.000000');
        assert.equal(purchase.payment.amount, '0.000000');
        assert.deepEqual((await service.listPurchases(contextA, PROJECT_A_ID)).map((row) => row.id), [purchase.id]);
        await assert.rejects(
          service.createPurchase(contextA, { ...input, projectId: PROJECT_A_SECOND_ID }),
          hasCode('BILLING_IDEMPOTENCY_CONFLICT'),
        );
      });

      await testContext.test('caller cannot forge commercial scope or payment state', async () => {
        const input = {
          projectId: PROJECT_A_ID,
          productCode: 'REFERENCE_APP_SANDBOX',
          priceId: REFERENCE_PRICE_ID,
          idempotencyKey: 'native-billing-0002',
        };
        for (const forged of [
          { ...input, ownerUserId: USER_B_ID },
          { ...input, organizationId: ORGANIZATION_B_ID },
          { ...input, appId: '00000000-0000-4000-8000-000000000002' },
          { ...input, amount: '1000000.00' },
          { ...input, status: 'PAID' },
        ]) {
          await assert.rejects(service.createPurchase(contextA, forged), hasCode('INVALID_BILLING_INPUT'));
        }
        await assert.rejects(
          client.query("UPDATE hive.payments SET status = 'PAID', confirmed_at = now()"),
          /permission denied|privilege/i,
        );
      });

      await testContext.test('purchase visibility does not cross user, workspace or app', async () => {
        await setContext(client, USER_B_ID, 'REFERENCE_APP', ORGANIZATION_B_ID);
        await assert.rejects(service.getPurchase(contextB, purchase.id), hasCode('PURCHASE_NOT_FOUND'));

        await setContext(client, USER_A_ID, 'REFERENCE_APP', SHARED_ORGANIZATION_ID);
        await assert.rejects(
          service.getPurchase({ ...contextA, organizationId: SHARED_ORGANIZATION_ID }, purchase.id),
          hasCode('PURCHASE_NOT_FOUND'),
        );

        await setContext(client, USER_A_ID, 'OTHER_TEST_APP', ORGANIZATION_A_ID);
        assert.deepEqual(await service.listCatalog({ ...contextA, appCode: 'OTHER_TEST_APP' }), []);
      });

      await testContext.test('admin can inspect catalog through SQL but cannot reuse owner commands', async () => {
        await setContext(client, ADMIN_ID, 'REFERENCE_APP', null, 'PLATFORM_ADMIN');
        const adminCatalog = await client.query('SELECT product_code FROM hive.products');
        assert.deepEqual(adminCatalog.rows, [{ product_code: 'REFERENCE_APP_SANDBOX' }]);
        await assert.rejects(
          service.listCatalog({ ...contextA, platformRole: 'PLATFORM_ADMIN' }),
          hasCode('BILLING_ACCESS_DENIED'),
        );
        assert.equal((await client.query('SELECT id FROM hive.purchases')).rows.length, 0);
      });

      await client.query('RESET ROLE');
      const retained = await client.query(
        `SELECT
           purchase.id,
           purchase.idempotency_key_sha256,
           payment.provider_payment_id,
           payment.provider_event_id
         FROM hive.purchases AS purchase
         JOIN hive.payments AS payment ON payment.purchase_id = purchase.id
         WHERE purchase.id = $1::uuid`,
        [purchase.id],
      );
      assert.equal(retained.rows.length, 1);
      assert.match(retained.rows[0].idempotency_key_sha256, /^[0-9a-f]{64}$/);
      assert.notEqual(retained.rows[0].idempotency_key_sha256, 'native-billing-0001');
      assert.equal(retained.rows[0].provider_payment_id, null);
      assert.equal(retained.rows[0].provider_event_id, null);
    } finally {
      await cleanupGreenHiveFixtures(client).catch(() => undefined);
      await client.end();
    }
  },
);
