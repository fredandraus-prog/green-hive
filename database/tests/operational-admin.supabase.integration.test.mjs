import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import pg from 'pg';
import {
  OperationalAdminAccessError,
  OperationalAdminService,
  PostgresOperationalAdminRepository,
} from '../../apps/hive-admin/dist/index.js';
import {
  assertLocalSupabaseTarget,
  assertNativeSupabaseContract,
  cleanupGreenHiveFixtures,
} from '../../scripts/lib/local-supabase-guard.mjs';
import {
  ADMIN_ID,
  ORGANIZATION_A_ID,
  REFERENCE_APP_ID,
  USER_A_ID,
} from './helpers/rls-matrix.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const databaseUrl = process.env.GREEN_HIVE_TEST_DATABASE_URL;
const confirmation = process.env.GREEN_HIVE_TEST_CONFIRM;
const target = process.env.GREEN_HIVE_TEST_TARGET;
const PROJECT_ID = '20000000-0000-4000-8000-000000000127';
const PRODUCT_ID = '40000000-0000-4000-8000-000000000127';
const PRICE_ID = '50000000-0000-4000-8000-000000000127';
const PURCHASE_ID = '60000000-0000-4000-8000-000000000127';
const PAYMENT_ID = '70000000-0000-4000-8000-000000000127';

function claims(subject, platformRole = 'USER') {
  return JSON.stringify({
    sub: subject,
    app_metadata: { app_code: 'REFERENCE_APP', platform_role: platformRole },
  });
}

async function setContext(client, subject, platformRole = 'USER') {
  await client.query(
    `SELECT set_config('request.jwt.claims', $1, false),
            set_config('request.green_hive.organization_id', '', false)`,
    [claims(subject, platformRole)],
  );
}

test(
  'GH-0801 platform admin receives aggregate operational state but no commercial writes or provider references',
  { skip: !databaseUrl || !confirmation ? 'local Supabase gate not configured' : false },
  async () => {
    assertLocalSupabaseTarget({ databaseUrl, target, confirmation });
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    try {
      await assertNativeSupabaseContract(client);
      await cleanupGreenHiveFixtures(client);
      await client.query(
        await readFile(
          path.join(repositoryRoot, 'database', 'tests', 'fixtures', '0001_rls_identities.sql'),
          'utf8',
        ),
      );
      await client.query(
        `INSERT INTO hive.projects (id, organization_id, app_id, owner_user_id, name)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Operational Admin Fixture')`,
        [PROJECT_ID, ORGANIZATION_A_ID, REFERENCE_APP_ID, USER_A_ID],
      );
      await client.query(
        `INSERT INTO hive.products (id, app_id, product_code, product_type, name)
         VALUES ($1::uuid, $2::uuid, 'ADMIN_FIXTURE', 'ONE_TIME', 'Operational Admin Fixture')`,
        [PRODUCT_ID, REFERENCE_APP_ID],
      );
      await client.query(
        `INSERT INTO hive.prices (id, product_id, app_id, version, currency, amount)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 1, 'USD', 1.000000)`,
        [PRICE_ID, PRODUCT_ID, REFERENCE_APP_ID],
      );
      await client.query(
        `INSERT INTO hive.purchases (
          id, organization_id, app_id, project_id, owner_user_id, product_id, price_id,
          product_code, price_version, amount, currency, status, idempotency_key_sha256, confirmed_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid,
          'ADMIN_FIXTURE', 1, 1.000000, 'USD', 'CONFIRMED', repeat('a', 64), now()
        )`,
        [PURCHASE_ID, ORGANIZATION_A_ID, REFERENCE_APP_ID, PROJECT_ID, USER_A_ID, PRODUCT_ID, PRICE_ID],
      );
      await client.query(
        `INSERT INTO hive.payments (
          id, purchase_id, organization_id, app_id, project_id, owner_user_id, attempt_number,
          status, amount, currency, provider_code, provider_payment_id, confirmed_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, 1,
          'PAID', 1.000000, 'USD', 'SANDBOX', 'private-provider-reference', now()
        )`,
        [PAYMENT_ID, PURCHASE_ID, ORGANIZATION_A_ID, REFERENCE_APP_ID, PROJECT_ID, USER_A_ID],
      );

      await client.query('SET ROLE authenticated');
      await setContext(client, ADMIN_ID, 'PLATFORM_ADMIN');
      const repository = new PostgresOperationalAdminRepository(client);
      const service = new OperationalAdminService(repository);
      const overview = await service.overview({
        userId: ADMIN_ID,
        appCode: 'REFERENCE_APP',
        platformRole: 'PLATFORM_ADMIN',
      });

      assert.deepEqual(overview.projects, { DRAFT: 1, ACTIVE: 0, ARCHIVED: 0, DELETED: 0 });
      assert.deepEqual(overview.purchases, { CONFIRMED: 1 });
      assert.deepEqual(overview.payments, { PAID: 1 });
      assert.equal(overview.users, 3);
      assert.equal(overview.workspaces, 3);
      await assert.rejects(
        client.query('SELECT provider_payment_id FROM hive.payments'),
        /permission denied|privilege/i,
      );
      await assert.rejects(
        client.query("UPDATE hive.purchases SET status = 'PENDING' WHERE id = $1::uuid", [PURCHASE_ID]),
        /permission denied|privilege/i,
      );

      await setContext(client, USER_A_ID);
      await assert.rejects(repository.overview(), OperationalAdminAccessError);
    } finally {
      await client.query('RESET ROLE').catch(() => undefined);
      await cleanupGreenHiveFixtures(client).catch(() => undefined);
      await client.query('DELETE FROM hive.prices WHERE id = $1::uuid', [PRICE_ID]).catch(() => undefined);
      await client.query('DELETE FROM hive.products WHERE id = $1::uuid', [PRODUCT_ID]).catch(() => undefined);
      await client.end();
    }
  },
);
