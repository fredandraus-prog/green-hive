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
  JobError,
  JobService,
  PostgresJobRepository,
  PostgresWorkerRepository,
  WorkerService,
} from '../../packages/jobs/dist/index.js';
import {
  NotificationService,
  PostgresNotificationRepository,
} from '../../packages/notifications/dist/index.js';
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
  REFERENCE_PRICE_ID,
  USER_A_ID,
  USER_B_ID,
} from './helpers/rls-matrix.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const databaseUrl = process.env.GREEN_HIVE_TEST_DATABASE_URL;
const confirmation = process.env.GREEN_HIVE_TEST_CONFIRM;
const target = process.env.GREEN_HIVE_TEST_TARGET;
const isStaging = target === SUPABASE_STAGING_TARGET;
const PROJECT_ID = '20000000-0000-4000-8000-000000000120';
const context = {
  userId: USER_A_ID,
  appCode: 'REFERENCE_APP',
  organizationId: ORGANIZATION_A_ID,
};
const worker = { workerId: 'native-reference-worker' };

function executor(client) {
  return { query(sql, parameters = []) { return client.query(sql, parameters); } };
}

function hasCode(code) {
  return (error) => error instanceof JobError && error.code === code;
}

async function setOwner(client) {
  await client.query(
    `SELECT set_config('request.jwt.claims', $1, false),
            set_config('request.green_hive.organization_id', $2, false)`,
    [JSON.stringify({ sub: USER_A_ID, app_metadata: { app_code: 'REFERENCE_APP' } }), ORGANIZATION_A_ID],
  );
}

test(
  'GH-0404/GH-0604 leased worker lifecycle and in-app notification isolation on native Supabase',
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
           to_regprocedure('hive.claim_next_job(text,integer)') IS NOT NULL AS claim_ready,
           to_regprocedure('hive.heartbeat_job(uuid,text,text,integer)') IS NOT NULL AS heartbeat_ready,
           to_regprocedure('hive.complete_job(uuid,text,text,text,text)') IS NOT NULL AS complete_ready,
           to_regprocedure('hive.fail_job(uuid,text,text,text,text)') IS NOT NULL AS fail_ready,
           to_regprocedure('hive.recover_expired_job_leases(integer)') IS NOT NULL AS recovery_ready,
           has_function_privilege('authenticated', 'hive.claim_next_job(text,integer)', 'EXECUTE')
             AS authenticated_claim,
           has_function_privilege('service_role', 'hive.claim_next_job(text,integer)', 'EXECUTE')
             AS service_claim`,
      );
      assert.deepEqual(baseline.rows[0], {
        migrations: catalog.migrations.length,
        claim_ready: true,
        heartbeat_ready: true,
        complete_ready: true,
        fail_ready: true,
        recovery_ready: true,
        authenticated_claim: false,
        service_claim: true,
      });

      await cleanupGreenHiveFixtures(client);
      await client.query(await readFile(
        path.join(repositoryRoot, 'database', 'tests', 'fixtures', '0001_rls_identities.sql'), 'utf8',
      ));
      await client.query('SET ROLE authenticated');
      await setOwner(client);
      await client.query(
        `INSERT INTO hive.projects (id, organization_id, app_id, owner_user_id, name)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Native Worker Foundation')`,
        [PROJECT_ID, ORGANIZATION_A_ID, REFERENCE_APP_ID, USER_A_ID],
      );

      const db = executor(client);
      const jobs = new JobService(new PostgresJobRepository(db));
      const billing = new BillingService(
        new PostgresBillingRepository(db), new FakeBillingProvider({ paymentOutcome: 'SUCCESS' }),
      );
      const purchase = await billing.createPurchase(context, {
        projectId: PROJECT_ID,
        productCode: 'REFERENCE_APP_SANDBOX',
        priceId: REFERENCE_PRICE_ID,
        idempotencyKey: 'native-worker-entitlement-0001',
      });
      await client.query('RESET ROLE');
      await billing.processPayment(context, purchase.id);
      const retryJob = await jobs.enqueue(context, {
        projectId: PROJECT_ID, jobType: 'REFERENCE_APP_FAKE_AI_JOB',
        idempotencyKey: 'native-worker-retry-0001', inputHash: '6'.repeat(64), priority: 100,
      });
      const permanentJob = await jobs.enqueue(context, {
        projectId: PROJECT_ID, jobType: 'REFERENCE_APP_FAKE_AI_JOB',
        idempotencyKey: 'native-worker-permanent-0001', inputHash: '7'.repeat(64), priority: 90,
      });

      const workers = new WorkerService(new PostgresWorkerRepository(db));
      await client.query('SET ROLE service_role');
      const firstLease = await workers.claim(worker, 60);
      assert.equal(firstLease.jobId, retryJob.id);
      assert.equal(await workers.fail(worker, {
        jobId: firstLease.jobId,
        leaseToken: firstLease.leaseToken,
        failureKind: 'TRANSIENT',
        safeErrorCode: 'UPSTREAM_TIMEOUT',
      }), 'RETRYING');
      await client.query('RESET ROLE');
      const retryDelay = await client.query(
        `SELECT extract(epoch FROM (available_at - updated_at))::integer AS seconds
         FROM hive.jobs WHERE id = $1::uuid`, [retryJob.id],
      );
      assert.equal(retryDelay.rows[0].seconds, 5);
      await client.query(
        `UPDATE hive.jobs SET available_at = clock_timestamp() - interval '1 second'
         WHERE id = $1::uuid`, [retryJob.id],
      );
      await client.query('SET ROLE service_role');
      const secondLease = await workers.claim(worker, 60);
      assert.equal(secondLease.jobId, retryJob.id);
      await workers.complete(worker, {
        jobId: secondLease.jobId,
        leaseToken: secondLease.leaseToken,
        outputHash: '8'.repeat(64),
      });
      const permanentLease = await workers.claim(worker, 60);
      assert.equal(permanentLease.jobId, permanentJob.id);
      assert.equal(await workers.fail(worker, {
        jobId: permanentLease.jobId,
        leaseToken: permanentLease.leaseToken,
        failureKind: 'PERMANENT',
        safeErrorCode: 'INVALID_DOMAIN_INPUT',
      }), 'FAILED');
      await assert.rejects(
        workers.heartbeat(worker, permanentLease.jobId, permanentLease.leaseToken, 60),
        hasCode('WORKER_LEASE_LOST'),
      );

      await client.query('RESET ROLE');
      await client.query('SET ROLE authenticated');
      await setOwner(client);
      const notifications = new NotificationService(new PostgresNotificationRepository(db));
      const ownerNotifications = await notifications.list(context);
      assert.equal(ownerNotifications.length, 1);
      assert.equal(ownerNotifications[0].jobId, retryJob.id);
      assert.equal(ownerNotifications[0].eventType, 'JOB_COMPLETED');
      assert.equal(ownerNotifications[0].status, 'UNREAD');
      assert.deepEqual(ownerNotifications[0].metadata, { jobType: 'REFERENCE_APP_FAKE_AI_JOB' });
      const acknowledged = await notifications.markRead(context, ownerNotifications[0].id);
      assert.equal(acknowledged.status, 'READ');
      assert.ok(acknowledged.readAt instanceof Date);
      assert.equal((await notifications.markRead(context, ownerNotifications[0].id)).status, 'READ');

      await client.query(
        `SELECT set_config('request.jwt.claims', $1, false),
                set_config('request.green_hive.organization_id', $2, false)`,
        [JSON.stringify({ sub: USER_B_ID, app_metadata: { app_code: 'REFERENCE_APP' } }), ORGANIZATION_A_ID],
      );
      assert.equal((await client.query('SELECT id FROM hive.notifications')).rows.length, 0);
      assert.equal((await client.query(
        `UPDATE hive.notifications SET status = 'READ', read_at = statement_timestamp()
         WHERE id = $1::uuid RETURNING id`, [ownerNotifications[0].id],
      )).rows.length, 0);

      await client.query(
        `SELECT set_config('request.jwt.claims', $1, false),
                set_config('request.green_hive.organization_id', $2, false)`,
        [JSON.stringify({
          sub: ADMIN_ID,
          app_metadata: { app_code: 'REFERENCE_APP', platform_role: 'PLATFORM_ADMIN' },
        }), ORGANIZATION_A_ID],
      );
      assert.equal((await client.query('SELECT id FROM hive.notifications')).rows.length, 1);
      assert.equal((await client.query(
        `UPDATE hive.notifications SET status = 'READ', read_at = statement_timestamp()
         WHERE id = $1::uuid RETURNING id`, [ownerNotifications[0].id],
      )).rows.length, 0);

      await client.query('RESET ROLE');
      const notificationEvidence = await client.query(
        `SELECT count(*)::integer AS notifications,
                count(*) FILTER (WHERE metadata ?| ARRAY[
                  'input', 'input_reference', 'output', 'output_reference',
                  'lease_token', 'file_key', 'signed_url', 'secret'
                ])::integer AS sensitive_metadata
         FROM hive.notifications
         WHERE job_id = $1::uuid`,
        [retryJob.id],
      );
      assert.deepEqual(notificationEvidence.rows[0], { notifications: 1, sensitive_metadata: 0 });

      const evidence = await client.query(
        `SELECT
           (SELECT status FROM hive.jobs WHERE id = $1::uuid) AS completed_status,
           (SELECT status FROM hive.jobs WHERE id = $2::uuid) AS failed_status,
           (SELECT count(*)::integer FROM audit.events
             WHERE subject_id IN ($1::uuid, $2::uuid) AND event_code = 'JOB_STARTED') AS starts,
           (SELECT count(*)::integer FROM audit.events
             WHERE subject_id IN ($1::uuid, $2::uuid)
               AND metadata ?| ARRAY[
                 'lease_token', 'lease_token_sha256', 'leased_by',
                 'input_sha256', 'input_reference', 'output_sha256', 'output_reference'
               ]) AS leaked`,
        [retryJob.id, permanentJob.id],
      );
      assert.deepEqual(evidence.rows[0], {
        completed_status: 'COMPLETED', failed_status: 'FAILED', starts: 3, leaked: 0,
      });
    } finally {
      await cleanupGreenHiveFixtures(client).catch(() => undefined);
      await client.end();
    }
  },
);
