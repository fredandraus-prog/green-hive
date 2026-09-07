import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { loadMigrationCatalog } from '../../scripts/lib/migration-catalog.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const USER_A_ID = '10000000-0000-4000-8000-000000000001';
const USER_B_ID = '10000000-0000-4000-8000-000000000002';
const ADMIN_ID = '10000000-0000-4000-8000-000000000003';
const ORGANIZATION_A_ID = '30000000-0000-4000-8000-000000000001';
const REFERENCE_APP_ID = '00000000-0000-4000-8000-000000000001';
const PRICE_ID = '50000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000161';
const IDEMPOTENCY = 'a'.repeat(64);
const FINGERPRINT = 'b'.repeat(64);
const CONTENT_HASH = 'c'.repeat(64);

const authShim = `
  CREATE SCHEMA auth;
  CREATE SCHEMA storage;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE TABLE storage.buckets (
    id text PRIMARY KEY,
    name text NOT NULL,
    public boolean NOT NULL DEFAULT false
  );
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
    [JSON.stringify({
      sub: userId,
      app_metadata: { app_code: appCode, platform_role: platformRole },
    }), organizationId ?? ''],
  );
}

async function grantGeneratedFileCapability(database) {
  await database.exec('RESET ROLE');
  await setContext(database, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
  const purchase = await database.query(
    `SELECT hive.create_pending_purchase(
       $1::uuid, 'REFERENCE_APP_SANDBOX', $2::uuid, 'files-entitlement-0001'
     )::text AS id`,
    [PROJECT_ID, PRICE_ID],
  );
  await database.query(
    `SELECT hive.apply_provider_payment_result(
       $1::uuid, 'GREEN_HIVE_FAKE_BILLING', 'files-entitlement-provider-0001', 'PAID'
     )`,
    [purchase.rows[0].id],
  );
}

function prepareFile(database, fingerprint = FINGERPRINT) {
  return database.query(
    `SELECT * FROM hive.prepare_generated_file(
       $1::uuid, $2::text, $3::text, 'summary.txt', 'text/plain', 24::bigint,
       'INTERNAL', $4::text, 'REFERENCE_APP_GENERATE_FILE',
       'GREEN_HIVE_FAKE_STORAGE', 'green-hive-generated'
     )`,
    [PROJECT_ID, IDEMPOTENCY, fingerprint, CONTENT_HASH],
  );
}

test('GH-0601 creates tenant-safe private generated-file metadata with owner-only RLS', async () => {
  const database = new PGlite({ extensions: { pgcrypto } });
  await database.waitReady;
  try {
    await prepare(database);
    await database.exec('SET ROLE authenticated');
    await setContext(database, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    await database.query(
      `INSERT INTO hive.projects (id, organization_id, app_id, owner_user_id, name)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Files project')`,
      [PROJECT_ID, ORGANIZATION_A_ID, REFERENCE_APP_ID, USER_A_ID],
    );
    await grantGeneratedFileCapability(database);

    const started = await prepareFile(database);
    assert.equal(started.rows.length, 1);
    const file = started.rows[0];
    assert.equal(file.status, 'PROCESSING');
    assert.match(file.storage_key, /^ghf\/[0-9a-f]{64}$/);
    assert.equal(file.storage_key.includes('summary'), false);
    assert.equal(file.required_capability, 'REFERENCE_APP_GENERATE_FILE');
    const repeated = await prepareFile(database);
    assert.equal(repeated.rows[0].file_id, file.file_id);
    await assert.rejects(
      () => prepareFile(database, 'd'.repeat(64)),
      /FILE_IDEMPOTENCY_CONFLICT/,
    );
    const completed = await database.query(
      `SELECT * FROM hive.complete_generated_file($1::uuid, 'fake-version-0001')`,
      [file.file_id],
    );
    assert.equal(completed.rows[0].status, 'READY');
    assert.equal(completed.rows[0].object_version, 'fake-version-0001');

    await database.exec('SET ROLE authenticated');
    await setContext(database, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    const ownerRead = await database.query(
      'SELECT id, original_filename, media_type, byte_size, sensitivity, status FROM hive.files',
    );
    assert.deepEqual(ownerRead.rows, [{
      id: file.file_id,
      original_filename: 'summary.txt',
      media_type: 'text/plain',
      byte_size: 24,
      sensitivity: 'INTERNAL',
      status: 'READY',
    }]);
    await assert.rejects(
      () => database.query('SELECT storage_key, content_sha256 FROM hive.files'),
      /permission denied|privilege/i,
    );
    await assert.rejects(
      () => database.query(
        `INSERT INTO hive.files (
           organization_id, app_id, project_id, owner_user_id, original_filename, media_type,
           byte_size, sensitivity, storage_provider, storage_bucket, storage_key, content_sha256,
           required_capability, idempotency_key_sha256, request_fingerprint_sha256
         ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'forged.txt', 'text/plain', 1,
           'INTERNAL', 'GREEN_HIVE_FAKE_STORAGE', 'green-hive-generated',
           'ghf/${'e'.repeat(64)}', '${'f'.repeat(64)}', 'REFERENCE_APP_GENERATE_FILE',
           '${'a'.repeat(64)}', '${'b'.repeat(64)}')`,
        [ORGANIZATION_A_ID, REFERENCE_APP_ID, PROJECT_ID, USER_A_ID],
      ),
      /permission denied|privilege|row-level security/i,
    );
    await assert.rejects(
      () => database.query(
        `SELECT hive.prepare_generated_file(
          $1::uuid, $2::text, $3::text, 'direct.txt', 'text/plain', 1::bigint,
          'INTERNAL', $4::text, 'REFERENCE_APP_GENERATE_FILE',
          'GREEN_HIVE_FAKE_STORAGE', 'green-hive-generated'
        )`,
        [PROJECT_ID, '1'.repeat(64), '2'.repeat(64), '3'.repeat(64)],
      ),
      /permission denied|privilege/i,
    );

    await setContext(database, USER_B_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    assert.equal((await database.query('SELECT id FROM hive.files')).rows.length, 0);
    await setContext(database, USER_A_ID, 'OTHER_TEST_APP', ORGANIZATION_A_ID);
    assert.equal((await database.query('SELECT id FROM hive.files')).rows.length, 0);
    await setContext(database, ADMIN_ID, 'REFERENCE_APP', null, 'PLATFORM_ADMIN');
    assert.equal((await database.query('SELECT id FROM hive.files')).rows.length, 0);

    await database.exec('RESET ROLE');
    await setContext(database, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    const deleted = await database.query('SELECT hive.soft_delete_file($1::uuid) AS deleted', [file.file_id]);
    assert.equal(deleted.rows[0].deleted, true);
    const repeatedDelete = await database.query('SELECT hive.soft_delete_file($1::uuid) AS deleted', [file.file_id]);
    assert.equal(repeatedDelete.rows[0].deleted, true);
    await database.exec('SET ROLE authenticated');
    await setContext(database, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    assert.equal((await database.query('SELECT id FROM hive.files')).rows.length, 0);
    await database.exec('RESET ROLE');
    const retained = await database.query('SELECT status, deleted_at FROM hive.files WHERE id = $1::uuid', [file.file_id]);
    assert.equal(retained.rows[0].status, 'DELETED');
    assert.ok(retained.rows[0].deleted_at);
    const prematureAudit = await database.query(
      "SELECT id FROM audit.events WHERE event_code = 'FILE_EXPORTED' AND project_id = $1::uuid",
      [PROJECT_ID],
    );
    assert.equal(prematureAudit.rows.length, 0);
  } finally {
    await database.close();
  }
});

test('GH-0602 rechecks owner scope before an auditable private-file export', async () => {
  const database = new PGlite({ extensions: { pgcrypto } });
  await database.waitReady;
  try {
    await prepare(database);
    await database.exec('RESET ROLE');
    await setContext(database, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    await database.query(
      `INSERT INTO hive.projects (id, organization_id, app_id, owner_user_id, name)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Download project')`,
      [PROJECT_ID, ORGANIZATION_A_ID, REFERENCE_APP_ID, USER_A_ID],
    );
    await grantGeneratedFileCapability(database);
    const prepared = await prepareFile(database);
    const file = prepared.rows[0];
    await database.query(
      `SELECT * FROM hive.complete_generated_file($1::uuid, 'download-version-0001')`,
      [file.file_id],
    );

    await database.exec('SET ROLE authenticated');
    await setContext(database, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    await assert.rejects(
      () => database.query(
        'SELECT hive.record_file_export($1::uuid, $2::uuid)',
        [PROJECT_ID, file.file_id],
      ),
      /permission denied|privilege/i,
    );
    await database.exec('RESET ROLE');
    await setContext(database, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    const recorded = await database.query(
      'SELECT hive.record_file_export($1::uuid, $2::uuid) AS recorded',
      [PROJECT_ID, file.file_id],
    );
    assert.equal(recorded.rows[0].recorded, true);
    const events = await database.query(
      `SELECT event_code, subject_type, subject_id, metadata
       FROM audit.events WHERE event_code = 'FILE_EXPORTED' AND project_id = $1::uuid`,
      [PROJECT_ID],
    );
    assert.equal(events.rows.length, 1);
    assert.deepEqual(events.rows[0], {
      event_code: 'FILE_EXPORTED',
      subject_type: 'FILE',
      subject_id: file.file_id,
      metadata: { byteSize: 24, mediaType: 'text/plain', sensitivity: 'INTERNAL' },
    });

    await setContext(database, USER_B_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    await assert.rejects(
      () => database.query('SELECT hive.record_file_export($1::uuid, $2::uuid)', [PROJECT_ID, file.file_id]),
      /FILE_ACCESS_DENIED/,
    );
    await setContext(database, USER_A_ID, 'OTHER_TEST_APP', ORGANIZATION_A_ID);
    await assert.rejects(
      () => database.query('SELECT hive.record_file_export($1::uuid, $2::uuid)', [PROJECT_ID, file.file_id]),
      /FILE_ACCESS_DENIED/,
    );
    await setContext(database, ADMIN_ID, 'REFERENCE_APP', ORGANIZATION_A_ID, 'PLATFORM_ADMIN');
    await assert.rejects(
      () => database.query('SELECT hive.record_file_export($1::uuid, $2::uuid)', [PROJECT_ID, file.file_id]),
      /FILE_ACCESS_DENIED/,
    );
  } finally {
    await database.close();
  }
});

test('GH-0603 restricts rendered private-file lifecycle to the exact active worker lease', async () => {
  const database = new PGlite({ extensions: { pgcrypto } });
  await database.waitReady;
  try {
    await prepare(database);
    await database.exec('RESET ROLE');
    await setContext(database, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    await database.query(
      `INSERT INTO hive.projects (id, organization_id, app_id, owner_user_id, name)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Render worker project')`,
      [PROJECT_ID, ORGANIZATION_A_ID, REFERENCE_APP_ID, USER_A_ID],
    );
    await grantGeneratedFileCapability(database);
    const queued = await database.query(
      `SELECT hive.enqueue_project_job(
         $1::uuid, 'REFERENCE_APP_RENDER_PROJECT_DOCUMENT', 'render-worker-file-0001',
         $2::text, 'render:pdf', 100
       )::text AS id`,
      [PROJECT_ID, 'd'.repeat(64)],
    );

    await database.exec('SET ROLE authenticated');
    await setContext(database, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    await assert.rejects(
      () => database.query(
        `SELECT * FROM hive.prepare_worker_rendered_file(
           $1::uuid, 'reference-render-worker', $2::text, 'project-document.pdf',
           'application/pdf', 24::bigint, $3::text, 'GREEN_HIVE_FAKE_STORAGE', 'green-hive-generated'
         )`,
        [queued.rows[0].id, '80000000-0000-4000-8000-000000000001', CONTENT_HASH],
      ),
      /permission denied|privilege/i,
    );

    await database.exec('RESET ROLE; SET ROLE service_role');
    const lease = await database.query(
      `SELECT * FROM hive.claim_next_job('reference-render-worker', 120)`,
    );
    assert.equal(lease.rows[0].job_type, 'REFERENCE_APP_RENDER_PROJECT_DOCUMENT');
    const prepared = await database.query(
      `SELECT * FROM hive.prepare_worker_rendered_file(
         $1::uuid, 'reference-render-worker', $2::text, 'project-document.pdf',
         'application/pdf', 24::bigint, $3::text, 'GREEN_HIVE_FAKE_STORAGE', 'green-hive-generated'
       )`,
      [lease.rows[0].job_id, lease.rows[0].lease_token, CONTENT_HASH],
    );
    const file = prepared.rows[0];
    assert.equal(file.status, 'PROCESSING');
    assert.match(file.storage_key, /^ghf\/[0-9a-f]{64}$/);
    const repeated = await database.query(
      `SELECT * FROM hive.prepare_worker_rendered_file(
         $1::uuid, 'reference-render-worker', $2::text, 'project-document.pdf',
         'application/pdf', 24::bigint, $3::text, 'GREEN_HIVE_FAKE_STORAGE', 'green-hive-generated'
       )`,
      [lease.rows[0].job_id, lease.rows[0].lease_token, CONTENT_HASH],
    );
    assert.equal(repeated.rows[0].file_id, file.file_id);
    await assert.rejects(
      () => database.query(
        `SELECT * FROM hive.complete_worker_rendered_file(
           $1::uuid, 'other-worker', $2::text, $3::uuid, 'worker-version-0001'
         )`,
        [lease.rows[0].job_id, lease.rows[0].lease_token, file.file_id],
      ),
      /WORKER_LEASE_LOST/,
    );
    const completed = await database.query(
      `SELECT hive.complete_worker_rendered_file(
         $1::uuid, 'reference-render-worker', $2::text, $3::uuid, 'worker-version-0001'
       ) AS completed`,
      [lease.rows[0].job_id, lease.rows[0].lease_token, file.file_id],
    );
    assert.equal(completed.rows[0].completed, true);
    const idempotent = await database.query(
      `SELECT hive.complete_worker_rendered_file(
         $1::uuid, 'reference-render-worker', $2::text, $3::uuid, 'worker-version-0001'
       ) AS completed`,
      [lease.rows[0].job_id, lease.rows[0].lease_token, file.file_id],
    );
    assert.equal(idempotent.rows[0].completed, true);
    const readyAbort = await database.query(
      `SELECT hive.abort_worker_rendered_file(
        $1::uuid, 'reference-render-worker', $2::text, $3::uuid
      ) AS aborted`,
      [lease.rows[0].job_id, lease.rows[0].lease_token, file.file_id],
    );
    assert.equal(readyAbort.rows[0].aborted, false);

    await database.exec('RESET ROLE');
    const retained = await database.query(
      'SELECT status, object_version FROM hive.files WHERE id = $1::uuid', [file.file_id],
    );
    assert.deepEqual(retained.rows, [{ status: 'READY', object_version: 'worker-version-0001' }]);
  } finally {
    await database.close();
  }
});
