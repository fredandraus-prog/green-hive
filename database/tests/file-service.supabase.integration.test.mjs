import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import pg from 'pg';
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
const PROJECT_ID = '20000000-0000-4000-8000-000000000161';
const PRICE_ID = '50000000-0000-4000-8000-000000000001';
const IDEMPOTENCY = 'a'.repeat(64);
const FINGERPRINT = 'b'.repeat(64);
const CONTENT_HASH = 'c'.repeat(64);

function claims(subject, appCode, platformRole = 'USER') {
  return JSON.stringify({
    sub: subject,
    app_metadata: { app_code: appCode, platform_role: platformRole },
  });
}

async function setContext(client, subject, appCode, organizationId, platformRole = 'USER') {
  await client.query(
    `SELECT set_config('request.jwt.claims', $1, false),
            set_config('request.green_hive.organization_id', $2, false)`,
    [claims(subject, appCode, platformRole), organizationId ?? ''],
  );
}

async function grantFileCapability(client) {
  await client.query('RESET ROLE');
  await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
  const purchase = await client.query(
    `SELECT hive.create_pending_purchase(
       $1::uuid, 'REFERENCE_APP_SANDBOX', $2::uuid, 'files-supabase-entitlement-0001'
     )::text AS id`,
    [PROJECT_ID, PRICE_ID],
  );
  await client.query(
    `SELECT hive.apply_provider_payment_result(
       $1::uuid, 'GREEN_HIVE_FAKE_BILLING', 'files-supabase-provider-0001', 'PAID'
     )`,
    [purchase.rows[0].id],
  );
}

test(
  'GH-0601 private file metadata lifecycle and RLS on native Supabase',
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
           to_regclass('hive.files') IS NOT NULL AS files_ready,
           EXISTS (
             SELECT 1 FROM pg_class AS relation
             JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
             WHERE namespace.nspname = 'hive' AND relation.relname = 'files'
               AND relation.relrowsecurity AND relation.relforcerowsecurity
           ) AS rls_ready,
           has_table_privilege('authenticated', 'hive.files', 'INSERT,UPDATE,DELETE')
             AS authenticated_write,
           has_column_privilege('authenticated', 'hive.files', 'storage_key', 'SELECT')
             AS storage_key_read,
           has_function_privilege(
             'authenticated',
             'hive.prepare_generated_file(uuid,text,text,text,text,bigint,text,text,text,text,text)',
             'EXECUTE'
           ) AS authenticated_prepare,
           has_function_privilege(
             'service_role',
             'hive.prepare_generated_file(uuid,text,text,text,text,bigint,text,text,text,text,text)',
             'EXECUTE'
           ) AS service_prepare,
           has_function_privilege(
             'authenticated', 'hive.record_file_export(uuid,uuid)', 'EXECUTE'
           ) AS authenticated_export,
           has_function_privilege(
             'service_role', 'hive.record_file_export(uuid,uuid)', 'EXECUTE'
           ) AS service_export,
           EXISTS (
             SELECT 1 FROM storage.buckets
             WHERE id = 'green-hive-generated' AND name = 'green-hive-generated' AND public = false
           ) AS private_bucket`,
      );
      assert.deepEqual(baseline.rows[0], {
        migrations: catalog.migrations.length,
        files_ready: true,
        rls_ready: true,
        authenticated_write: false,
        storage_key_read: false,
        authenticated_prepare: false,
        service_prepare: true,
        authenticated_export: false,
        service_export: true,
        private_bucket: true,
      });

      await cleanupGreenHiveFixtures(client);
      await client.query(await readFile(
        path.join(repositoryRoot, 'database', 'tests', 'fixtures', '0001_rls_identities.sql'),
        'utf8',
      ));
      await client.query(
        `INSERT INTO hive.projects (id, organization_id, app_id, owner_user_id, name)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Native Files Project')`,
        [PROJECT_ID, ORGANIZATION_A_ID, REFERENCE_APP_ID, USER_A_ID],
      );
      await grantFileCapability(client);

      const prepared = await client.query(
        `SELECT * FROM hive.prepare_generated_file(
           $1::uuid, $2::text, $3::text, 'native-report.txt', 'text/plain', 24::bigint,
           'INTERNAL', $4::text, 'REFERENCE_APP_GENERATE_FILE',
           'GREEN_HIVE_FAKE_STORAGE', 'green-hive-generated'
         )`,
        [PROJECT_ID, IDEMPOTENCY, FINGERPRINT, CONTENT_HASH],
      );
      const file = prepared.rows[0];
      assert.equal(file.status, 'PROCESSING');
      assert.match(file.storage_key, /^ghf\/[0-9a-f]{64}$/);
      assert.equal(file.storage_key.includes('native-report'), false);
      const replay = await client.query(
        `SELECT * FROM hive.prepare_generated_file(
           $1::uuid, $2::text, $3::text, 'native-report.txt', 'text/plain', 24::bigint,
           'INTERNAL', $4::text, 'REFERENCE_APP_GENERATE_FILE',
           'GREEN_HIVE_FAKE_STORAGE', 'green-hive-generated'
         )`,
        [PROJECT_ID, IDEMPOTENCY, FINGERPRINT, CONTENT_HASH],
      );
      assert.equal(replay.rows[0].file_id, file.file_id);
      await client.query(
        `SELECT * FROM hive.complete_generated_file($1::uuid, 'native-version-0001')`,
        [file.file_id],
      );

      await client.query('SET ROLE authenticated');
      await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
      await assert.rejects(
        () => client.query('SELECT hive.record_file_export($1::uuid, $2::uuid)', [PROJECT_ID, file.file_id]),
        /permission denied|privilege/i,
      );
      await client.query('RESET ROLE');
      await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
      assert.equal((await client.query(
        'SELECT hive.record_file_export($1::uuid, $2::uuid) AS recorded', [PROJECT_ID, file.file_id],
      )).rows[0].recorded, true);
      const exportEvent = await client.query(
        `SELECT subject_type, subject_id, metadata
         FROM audit.events WHERE event_code = 'FILE_EXPORTED' AND project_id = $1::uuid`,
        [PROJECT_ID],
      );
      assert.deepEqual(exportEvent.rows, [{
        subject_type: 'FILE',
        subject_id: file.file_id,
        metadata: { byteSize: 24, mediaType: 'text/plain', sensitivity: 'INTERNAL' },
      }]);

      await client.query('SET ROLE authenticated');
      await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
      const ownerRows = await client.query(
        'SELECT id, original_filename, status FROM hive.files ORDER BY created_at',
      );
      assert.deepEqual(ownerRows.rows, [{
        id: file.file_id,
        original_filename: 'native-report.txt',
        status: 'READY',
      }]);
      await assert.rejects(
        () => client.query('SELECT storage_key FROM hive.files'),
        /permission denied|privilege/i,
      );
      await assert.rejects(
        () => client.query(
          `INSERT INTO hive.files (organization_id, app_id, project_id, owner_user_id, original_filename,
            media_type, byte_size, sensitivity, storage_provider, storage_bucket, storage_key,
            content_sha256, required_capability, idempotency_key_sha256, request_fingerprint_sha256)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'forged.txt', 'text/plain', 1,
             'INTERNAL', 'GREEN_HIVE_FAKE_STORAGE', 'green-hive-generated', 'ghf/${'d'.repeat(64)}',
             '${'e'.repeat(64)}', 'REFERENCE_APP_GENERATE_FILE', '${'f'.repeat(64)}', '${'a'.repeat(64)}')`,
          [ORGANIZATION_A_ID, REFERENCE_APP_ID, PROJECT_ID, USER_A_ID],
        ),
        /permission denied|privilege|row-level security/i,
      );
      await setContext(client, USER_B_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
      assert.equal((await client.query('SELECT id FROM hive.files')).rows.length, 0);
      await setContext(client, USER_A_ID, 'OTHER_TEST_APP', ORGANIZATION_A_ID);
      assert.equal((await client.query('SELECT id FROM hive.files')).rows.length, 0);
      await setContext(client, ADMIN_ID, 'REFERENCE_APP', ORGANIZATION_A_ID, 'PLATFORM_ADMIN');
      assert.equal((await client.query('SELECT id FROM hive.files')).rows.length, 0);

      await client.query('RESET ROLE');
      await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
      assert.equal((await client.query(
        'SELECT hive.soft_delete_file($1::uuid) AS deleted', [file.file_id],
      )).rows[0].deleted, true);
      await client.query('SET ROLE authenticated');
      await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
      assert.equal((await client.query('SELECT id FROM hive.files')).rows.length, 0);
      await client.query('RESET ROLE');
      const retained = await client.query('SELECT status, deleted_at FROM hive.files WHERE id = $1::uuid', [file.file_id]);
      assert.equal(retained.rows[0].status, 'DELETED');
      assert.ok(retained.rows[0].deleted_at);
      assert.equal((await client.query(
        "SELECT count(*)::integer AS count FROM audit.events WHERE event_code = 'FILE_EXPORTED' AND project_id = $1::uuid",
        [PROJECT_ID],
      )).rows[0].count, 1);
    } finally {
      await client.query('RESET ROLE').catch(() => undefined);
      await cleanupGreenHiveFixtures(client).catch(() => undefined);
      await client.end();
    }
  },
);
