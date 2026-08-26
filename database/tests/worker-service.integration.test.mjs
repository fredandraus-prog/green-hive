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
  JobError,
  JobService,
  PostgresJobRepository,
  PostgresWorkerRepository,
  WorkerService,
} from '../../packages/jobs/dist/index.js';
import { loadMigrationCatalog } from '../../scripts/lib/migration-catalog.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const USER_ID = '10000000-0000-4000-8000-000000000001';
const ORGANIZATION_ID = '30000000-0000-4000-8000-000000000001';
const APP_ID = '00000000-0000-4000-8000-000000000001';
const PRICE_ID = '50000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000120';
const context = { userId: USER_ID, appCode: 'REFERENCE_APP', organizationId: ORGANIZATION_ID };
const workerA = { workerId: 'reference-worker-a' };
const workerB = { workerId: 'reference-worker-b' };

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
    if (file.endsWith('.sql')) await database.exec(await readFile(
      path.join(repositoryRoot, 'database', 'seeds', file), 'utf8',
    ));
  }
  await database.exec(await readFile(
    path.join(repositoryRoot, 'database', 'tests', 'fixtures', '0001_rls_identities.sql'), 'utf8',
  ));
}

async function setOwner(database) {
  await database.exec('SET ROLE authenticated;');
  await database.query(
    `SELECT set_config('request.jwt.claims', $1, false),
            set_config('request.green_hive.organization_id', $2, false)`,
    [JSON.stringify({ sub: USER_ID, app_metadata: { app_code: 'REFERENCE_APP' } }), ORGANIZATION_ID],
  );
}

function executor(database) {
  return { query(sql, parameters = []) { return database.query(sql, parameters); } };
}

function hasCode(code) {
  return (error) => error instanceof JobError && error.code === code;
}

test('GH-0404 claims once, renews ownership, retries deterministically and protects worker secrets', async () => {
  const database = new PGlite({ extensions: { pgcrypto } });
  await database.waitReady;
  try {
    await prepare(database);
    await setOwner(database);
    await database.query(
      `INSERT INTO hive.projects (id, organization_id, app_id, owner_user_id, name)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Worker Foundation')`,
      [PROJECT_ID, ORGANIZATION_ID, APP_ID, USER_ID],
    );
    const db = executor(database);
    const jobs = new JobService(new PostgresJobRepository(db));
    const billing = new BillingService(
      new PostgresBillingRepository(db), new FakeBillingProvider({ paymentOutcome: 'SUCCESS' }),
    );
    const purchase = await billing.createPurchase(context, {
      projectId: PROJECT_ID,
      productCode: 'REFERENCE_APP_SANDBOX',
      priceId: PRICE_ID,
      idempotencyKey: 'worker-entitlement-0001',
    });
    await database.exec('RESET ROLE;');
    await billing.processPayment(context, purchase.id);
    const first = await jobs.enqueue(context, {
      projectId: PROJECT_ID,
      jobType: 'REFERENCE_APP_FAKE_AI_JOB',
      idempotencyKey: 'worker-retry-complete-0001',
      inputHash: '1'.repeat(64),
      inputReference: 'reference-app://inputs/worker-0001',
      priority: 100,
    });

    await database.exec('RESET ROLE; SET ROLE service_role;');
    const workers = new WorkerService(new PostgresWorkerRepository(db));
    const simultaneous = await Promise.all([workers.claim(workerA, 60), workers.claim(workerB, 60)]);
    const leases = simultaneous.filter(Boolean);
    assert.equal(leases.length, 1);
    assert.equal(leases[0].jobId, first.id);
    assert.equal(leases[0].attemptCount, 1);
    assert.equal(leases[0].inputHash, '1'.repeat(64));
    assert.equal(leases[0].inputReference, 'reference-app://inputs/worker-0001');
    const owner = simultaneous[0] ? workerA : workerB;
    const intruder = simultaneous[0] ? workerB : workerA;
    const lease = leases[0];
    await assert.rejects(
      workers.heartbeat(intruder, lease.jobId, lease.leaseToken, 60),
      hasCode('WORKER_LEASE_LOST'),
    );
    const renewed = await workers.heartbeat(owner, lease.jobId, lease.leaseToken, 120);
    assert.ok(renewed > lease.leaseExpiresAt);
    assert.equal(await workers.fail(owner, {
      jobId: lease.jobId,
      leaseToken: lease.leaseToken,
      failureKind: 'TRANSIENT',
      safeErrorCode: 'UPSTREAM_TIMEOUT',
    }), 'RETRYING');
    assert.equal(await workers.claim(workerA, 60), null, 'retry delay must prevent a hot loop');

    await database.exec('RESET ROLE;');
    const retryState = await database.query(
      `SELECT status, attempt_count,
              extract(epoch FROM (available_at - updated_at))::integer AS retry_seconds,
              lease_token_sha256 IS NULL AS lease_cleared
       FROM hive.jobs WHERE id = $1::uuid`, [first.id],
    );
    assert.deepEqual(retryState.rows[0], {
      status: 'RETRYING', attempt_count: 1, retry_seconds: 5, lease_cleared: true,
    });
    await database.query(
      `UPDATE hive.jobs SET available_at = clock_timestamp() - interval '1 second'
       WHERE id = $1::uuid`, [first.id],
    );
    await database.exec('SET ROLE service_role;');
    const retryLease = await workers.claim(workerA, 60);
    assert.equal(retryLease.jobId, first.id);
    assert.equal(retryLease.attemptCount, 2);
    await workers.complete(workerA, {
      jobId: retryLease.jobId,
      leaseToken: retryLease.leaseToken,
      outputHash: '2'.repeat(64),
      outputReference: 'reference-app://outputs/worker-0001',
    });
    await assert.rejects(
      workers.complete(workerA, { jobId: retryLease.jobId, leaseToken: retryLease.leaseToken }),
      hasCode('WORKER_LEASE_LOST'),
    );

    await database.exec('RESET ROLE;');
    const completed = await database.query(
      `SELECT status, attempt_count, output_sha256, output_reference,
              leased_by IS NULL AS lease_cleared,
              lease_token_sha256 IS NULL AS token_cleared
       FROM hive.jobs WHERE id = $1::uuid`, [first.id],
    );
    assert.deepEqual(completed.rows[0], {
      status: 'COMPLETED', attempt_count: 2, output_sha256: '2'.repeat(64),
      output_reference: 'reference-app://outputs/worker-0001',
      lease_cleared: true, token_cleared: true,
    });

    const expired = await jobs.enqueue(context, {
      projectId: PROJECT_ID, jobType: 'REFERENCE_APP_FAKE_AI_JOB',
      idempotencyKey: 'worker-expired-0001', inputHash: '3'.repeat(64), priority: 90,
    });
    const cancelled = await jobs.enqueue(context, {
      projectId: PROJECT_ID, jobType: 'REFERENCE_APP_FAKE_AI_JOB',
      idempotencyKey: 'worker-cancel-0001', inputHash: '4'.repeat(64), priority: 80,
    });
    const permanent = await jobs.enqueue(context, {
      projectId: PROJECT_ID, jobType: 'REFERENCE_APP_FAKE_AI_JOB',
      idempotencyKey: 'worker-permanent-0001', inputHash: '5'.repeat(64), priority: 70,
    });
    await database.exec('RESET ROLE; SET ROLE service_role;');
    const expiredLease = await workers.claim(workerA, 60);
    assert.equal(expiredLease.jobId, expired.id);
    await database.exec('RESET ROLE;');
    await database.query(
      `UPDATE hive.jobs SET lease_expires_at = clock_timestamp() - interval '1 second'
       WHERE id = $1::uuid`, [expired.id],
    );
    await database.exec('SET ROLE service_role;');
    assert.deepEqual(await workers.recoverExpired(10), [{ jobId: expired.id, status: 'RETRYING' }]);
    await assert.rejects(
      workers.heartbeat(workerA, expiredLease.jobId, expiredLease.leaseToken, 60),
      hasCode('WORKER_LEASE_LOST'),
    );

    const cancelLease = await workers.claim(workerB, 60);
    assert.equal(cancelLease.jobId, cancelled.id);
    await workers.cancel(workerB, cancelLease.jobId, cancelLease.leaseToken);
    const permanentLease = await workers.claim(workerA, 60);
    assert.equal(permanentLease.jobId, permanent.id);
    assert.equal(await workers.fail(workerA, {
      jobId: permanentLease.jobId, leaseToken: permanentLease.leaseToken,
      failureKind: 'PERMANENT', safeErrorCode: 'INVALID_DOMAIN_INPUT',
    }), 'FAILED');

    await database.exec('RESET ROLE;');
    await database.query(
      `UPDATE hive.jobs SET available_at = clock_timestamp() - interval '1 second'
       WHERE id = $1::uuid`, [expired.id],
    );
    await database.exec('SET ROLE service_role;');
    const attemptTwo = await workers.claim(workerA, 60);
    assert.equal(await workers.fail(workerA, {
      jobId: attemptTwo.jobId, leaseToken: attemptTwo.leaseToken,
      failureKind: 'TRANSIENT', safeErrorCode: 'UPSTREAM_TIMEOUT',
    }), 'RETRYING');
    await database.exec('RESET ROLE;');
    await database.query(
      `UPDATE hive.jobs SET available_at = clock_timestamp() - interval '1 second'
       WHERE id = $1::uuid`, [expired.id],
    );
    await database.exec('SET ROLE service_role;');
    const attemptThree = await workers.claim(workerA, 60);
    assert.equal(attemptThree.attemptCount, 3);
    assert.equal(await workers.fail(workerA, {
      jobId: attemptThree.jobId, leaseToken: attemptThree.leaseToken,
      failureKind: 'TRANSIENT', safeErrorCode: 'UPSTREAM_TIMEOUT',
    }), 'FAILED');

    await database.exec('RESET ROLE; SET ROLE authenticated;');
    await assert.rejects(database.query(
      `SELECT hive.claim_next_job('browser-worker', 60)`,
    ), /permission denied|privilege/i);
    await assert.rejects(database.query(
      `SELECT hive.recover_expired_job_leases(10)`,
    ), /permission denied|privilege/i);
    await setOwner(database);
    await assert.rejects(database.query(
      'SELECT lease_token_sha256, leased_by, output_sha256 FROM hive.jobs LIMIT 1',
    ), /permission denied|privilege/i);

    await database.exec('RESET ROLE;');
    const evidence = await database.query(
      `SELECT
         (SELECT status FROM hive.jobs WHERE id = $1::uuid) AS completed_status,
         (SELECT status FROM hive.jobs WHERE id = $2::uuid) AS exhausted_status,
         (SELECT status FROM hive.jobs WHERE id = $3::uuid) AS cancelled_status,
         (SELECT status FROM hive.jobs WHERE id = $4::uuid) AS permanent_status,
         (SELECT count(*)::integer FROM audit.events
           WHERE subject_id IN ($1::uuid, $2::uuid, $3::uuid, $4::uuid)
             AND event_code = 'JOB_STARTED') AS started_events,
         (SELECT count(*)::integer FROM audit.events
           WHERE subject_id IN ($1::uuid, $2::uuid, $3::uuid, $4::uuid)
             AND event_code = 'JOB_RETRY_SCHEDULED') AS retry_events,
         (SELECT count(*)::integer FROM audit.events
           WHERE subject_id IN ($1::uuid, $2::uuid, $3::uuid, $4::uuid)
             AND metadata ?| ARRAY[
               'lease_token', 'lease_token_sha256', 'leased_by',
               'input_sha256', 'input_reference', 'output_sha256', 'output_reference',
               'idempotency_key_sha256', 'request_fingerprint_sha256'
             ]) AS leaked_audit`,
      [first.id, expired.id, cancelled.id, permanent.id],
    );
    assert.deepEqual(evidence.rows[0], {
      completed_status: 'COMPLETED', exhausted_status: 'FAILED',
      cancelled_status: 'CANCELLED', permanent_status: 'FAILED',
      started_events: 7, retry_events: 3, leaked_audit: 0,
    });
  } finally {
    await database.close();
  }
});
