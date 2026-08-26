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
import { JobError, JobService, PostgresJobRepository } from '../../packages/jobs/dist/index.js';
import { loadMigrationCatalog } from '../../scripts/lib/migration-catalog.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const USER_A_ID = '10000000-0000-4000-8000-000000000001';
const USER_B_ID = '10000000-0000-4000-8000-000000000002';
const ADMIN_ID = '10000000-0000-4000-8000-000000000003';
const ORGANIZATION_A_ID = '30000000-0000-4000-8000-000000000001';
const ORGANIZATION_B_ID = '30000000-0000-4000-8000-000000000002';
const REFERENCE_APP_ID = '00000000-0000-4000-8000-000000000001';
const REFERENCE_PRICE_ID = '50000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000119';
const contextA = {
  userId: USER_A_ID,
  appCode: 'REFERENCE_APP',
  organizationId: ORGANIZATION_A_ID,
};

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
  CREATE ROLE authenticated
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  CREATE ROLE service_role
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;
  GRANT USAGE ON SCHEMA auth TO authenticated, service_role;
  GRANT EXECUTE ON FUNCTION auth.jwt() TO authenticated, service_role;
  GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, service_role;
`;

async function applyMigrations(database) {
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
}

async function applySeedsAndFixtures(database) {
  const seedsDirectory = path.join(repositoryRoot, 'database', 'seeds');
  for (const file of (await readdir(seedsDirectory)).filter((name) => name.endsWith('.sql')).sort()) {
    await database.exec(await readFile(path.join(seedsDirectory, file), 'utf8'));
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

function executor(database) {
  return { query(sql, parameters = []) { return database.query(sql, parameters); } };
}

function hasCode(code) {
  return (error) => error instanceof JobError && error.code === code;
}

test('GH-0403 queue remains tenant-safe after the GH-0404 worker lifecycle is installed', async () => {
  const database = new PGlite({ extensions: { pgcrypto } });
  await database.waitReady;
  try {
    await database.exec(authShim);
    await applyMigrations(database);
    await applySeedsAndFixtures(database);
    await database.exec('SET ROLE authenticated;');
    await setContext(database, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    await database.query(
      `INSERT INTO hive.projects (id, organization_id, app_id, owner_user_id, name)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Jobs Foundation')`,
      [PROJECT_ID, ORGANIZATION_A_ID, REFERENCE_APP_ID, USER_A_ID],
    );

    const databaseExecutor = executor(database);
    const jobs = new JobService(new PostgresJobRepository(databaseExecutor));
    const billing = new BillingService(
      new PostgresBillingRepository(databaseExecutor),
      new FakeBillingProvider({ paymentOutcome: 'SUCCESS' }),
    );
    const purchase = await billing.createPurchase(contextA, {
      projectId: PROJECT_ID,
      productCode: 'REFERENCE_APP_SANDBOX',
      priceId: REFERENCE_PRICE_ID,
      idempotencyKey: 'jobs-entitlement-0001',
    });

    await database.exec('RESET ROLE;');
    const enqueueInput = {
      projectId: PROJECT_ID,
      jobType: 'REFERENCE_APP_FAKE_AI_JOB',
      idempotencyKey: 'reference-job-db-0001',
      inputHash: 'd'.repeat(64),
      inputReference: 'reference-app://inputs/db-0001',
      priority: 75,
    };
    await assert.rejects(jobs.enqueue(contextA, enqueueInput), hasCode('JOB_ENTITLEMENT_REQUIRED'));
    await billing.processPayment(contextA, purchase.id);

    const created = await jobs.enqueue(contextA, enqueueInput);
    const replay = await jobs.enqueue(contextA, enqueueInput);
    assert.equal(replay.id, created.id);
    assert.equal(created.status, 'QUEUED');
    assert.equal(created.attemptCount, 0);
    assert.equal(created.maxAttempts, 3);
    assert.equal(created.retryPolicy, 'EXPONENTIAL_BACKOFF');
    assert.equal(created.timeoutClass, 'SHORT');
    assert.equal((await jobs.get(contextA, PROJECT_ID, created.id)).id, created.id);
    await assert.rejects(
      jobs.enqueue(contextA, { ...enqueueInput, inputHash: 'e'.repeat(64) }),
      hasCode('JOB_IDEMPOTENCY_CONFLICT'),
    );
    await assert.rejects(
      jobs.enqueue(contextA, { ...enqueueInput, idempotencyKey: 'unregistered-0001', jobType: 'REFERENCE_APP_UNKNOWN_JOB' }),
      hasCode('JOB_NOT_REGISTERED'),
    );

    const stored = await database.query(
      `SELECT count(*)::integer AS count,
              bool_and(status = 'QUEUED' AND attempt_count = 0) AS queue_only,
              bool_and(idempotency_key_sha256 <> 'reference-job-db-0001') AS key_hashed,
              bool_and(input_sha256 = $2) AS input_hashed
       FROM hive.jobs WHERE id = $1::uuid`,
      [created.id, 'd'.repeat(64)],
    );
    assert.deepEqual(stored.rows[0], {
      count: 1, queue_only: true, key_hashed: true, input_hashed: true,
    });

    await setContext(database, USER_B_ID, 'REFERENCE_APP', ORGANIZATION_B_ID);
    await assert.rejects(
      jobs.get({ userId: USER_B_ID, appCode: 'REFERENCE_APP', organizationId: ORGANIZATION_B_ID }, PROJECT_ID, created.id),
      hasCode('JOB_NOT_FOUND'),
    );
    await setContext(database, USER_A_ID, 'OTHER_TEST_APP', ORGANIZATION_A_ID);
    await assert.rejects(
      jobs.get({ ...contextA, appCode: 'OTHER_TEST_APP' }, PROJECT_ID, created.id),
      hasCode('JOB_NOT_FOUND'),
    );

    await database.exec('SET ROLE authenticated;');
    await setContext(database, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    assert.equal((await database.query('SELECT id, status FROM hive.jobs WHERE id = $1::uuid', [created.id])).rows.length, 1);
    await assert.rejects(
      database.query('SELECT input_sha256 FROM hive.jobs WHERE id = $1::uuid', [created.id]),
      /permission denied|privilege/i,
    );
    await assert.rejects(
      database.query(
        `SELECT hive.enqueue_project_job($1::uuid, 'REFERENCE_APP_FAKE_AI_JOB',
          'browser-forged', $2, NULL, 50)`,
        [PROJECT_ID, 'f'.repeat(64)],
      ),
      /permission denied|privilege/i,
    );
    await assert.rejects(database.query('UPDATE hive.jobs SET priority = 100'), /permission denied|privilege/i);
    await assert.rejects(database.query('DELETE FROM hive.jobs'), /permission denied|privilege/i);

    await setContext(database, ADMIN_ID, 'REFERENCE_APP', null, 'PLATFORM_ADMIN');
    assert.equal((await database.query('SELECT id, status FROM hive.jobs WHERE id = $1::uuid', [created.id])).rows.length, 1);
    await assert.rejects(database.query('UPDATE hive.jobs SET priority = 1'), /permission denied|privilege/i);

    await database.exec('RESET ROLE;');
    const evidence = await database.query(
      `SELECT
         (SELECT count(*)::integer FROM hive.jobs WHERE id = $1::uuid) AS jobs,
         (SELECT count(*)::integer FROM audit.events
           WHERE subject_id = $1::uuid AND event_code = 'JOB_QUEUED') AS audit_events,
         (SELECT count(*)::integer FROM audit.events
           WHERE subject_id = $1::uuid
             AND metadata::text ~* '(input_sha256|input_reference|idempotency|hash)') AS leaked_audit,
         to_regprocedure('hive.claim_next_job(text,integer)') IS NOT NULL AS worker_claim_ready`,
      [created.id],
    );
    assert.deepEqual(evidence.rows[0], {
      jobs: 1, audit_events: 1, leaked_audit: 0, worker_claim_ready: true,
    });
  } finally {
    await database.close();
  }
});
