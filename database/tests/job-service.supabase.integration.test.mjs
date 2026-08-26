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
import { JobError, JobService, PostgresJobRepository } from '../../packages/jobs/dist/index.js';
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
  USER_A_ID,
  USER_B_ID,
} from './helpers/rls-matrix.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const databaseUrl = process.env.GREEN_HIVE_TEST_DATABASE_URL;
const confirmation = process.env.GREEN_HIVE_TEST_CONFIRM;
const target = process.env.GREEN_HIVE_TEST_TARGET;
const isStaging = target === SUPABASE_STAGING_TARGET;
const PROJECT_ID = '20000000-0000-4000-8000-000000000119';
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
    `SELECT set_config('request.jwt.claims', $1, false),
            set_config('request.green_hive.organization_id', $2, false)`,
    [claims(subject, appCode, platformRole), organizationId ?? ''],
  );
}

function executor(client) {
  return { query(sql, parameters = []) { return client.query(sql, parameters); } };
}

function hasCode(code) {
  return (error) => error instanceof JobError && error.code === code;
}

test(
  'GH-0403 idempotent Jobs foundation on native Supabase',
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
           (SELECT count(*)::integer FROM hive.job_registrations
             WHERE id = '70000000-0000-4000-8000-000000000001'::uuid
               AND job_type = 'REFERENCE_APP_FAKE_AI_JOB' AND active) AS registrations,
           to_regclass('hive.jobs') IS NOT NULL AS jobs_ready,
           to_regprocedure(
             'hive.enqueue_project_job(uuid,text,text,text,text,integer)'
           ) IS NOT NULL AS enqueue_ready`,
      );
      assert.deepEqual(baseline.rows[0], {
        migrations: catalog.migrations.length,
        registrations: 1,
        jobs_ready: true,
        enqueue_ready: true,
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
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Native Jobs Foundation')`,
        [PROJECT_ID, ORGANIZATION_A_ID, REFERENCE_APP_ID, USER_A_ID],
      );

      const database = executor(client);
      const jobs = new JobService(new PostgresJobRepository(database));
      const billing = new BillingService(
        new PostgresBillingRepository(database),
        new FakeBillingProvider({ paymentOutcome: 'SUCCESS' }),
      );
      const purchase = await billing.createPurchase(contextA, {
        projectId: PROJECT_ID,
        productCode: 'REFERENCE_APP_SANDBOX',
        priceId: REFERENCE_PRICE_ID,
        idempotencyKey: 'native-jobs-entitlement-0001',
      });
      await client.query('RESET ROLE');

      const input = {
        projectId: PROJECT_ID,
        jobType: 'REFERENCE_APP_FAKE_AI_JOB',
        idempotencyKey: 'native-job-0001',
        inputHash: '1'.repeat(64),
        inputReference: 'reference-app://inputs/native-0001',
      };
      await assert.rejects(jobs.enqueue(contextA, input), hasCode('JOB_ENTITLEMENT_REQUIRED'));
      await billing.processPayment(contextA, purchase.id);
      const created = await jobs.enqueue(contextA, input);
      assert.equal((await jobs.enqueue(contextA, input)).id, created.id);
      await assert.rejects(
        jobs.enqueue(contextA, { ...input, inputHash: '2'.repeat(64) }),
        hasCode('JOB_IDEMPOTENCY_CONFLICT'),
      );

      await setContext(client, USER_B_ID, 'REFERENCE_APP', ORGANIZATION_B_ID);
      await assert.rejects(
        jobs.get(
          { userId: USER_B_ID, appCode: 'REFERENCE_APP', organizationId: ORGANIZATION_B_ID },
          PROJECT_ID,
          created.id,
        ),
        hasCode('JOB_NOT_FOUND'),
      );
      await client.query('SET ROLE authenticated');
      await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
      assert.equal((await client.query('SELECT id, status FROM hive.jobs WHERE id = $1', [created.id])).rows.length, 1);
      await assert.rejects(
        client.query('SELECT input_sha256 FROM hive.jobs WHERE id = $1', [created.id]),
        /permission denied|privilege/i,
      );
      await assert.rejects(
        client.query(
          `SELECT hive.enqueue_project_job($1::uuid, 'REFERENCE_APP_FAKE_AI_JOB',
            'native-browser-forged', $2, NULL, 50)`,
          [PROJECT_ID, '3'.repeat(64)],
        ),
        /permission denied|privilege/i,
      );
      await setContext(client, ADMIN_ID, 'REFERENCE_APP', null, 'PLATFORM_ADMIN');
      assert.equal((await client.query('SELECT id FROM hive.jobs WHERE id = $1', [created.id])).rows.length, 1);
      await assert.rejects(client.query('UPDATE hive.jobs SET priority = 1'), /permission denied|privilege/i);

      await client.query('RESET ROLE');
      const evidence = await client.query(
        `SELECT
           (SELECT count(*)::integer FROM hive.jobs WHERE id = $1) AS jobs,
           (SELECT count(*)::integer FROM audit.events
             WHERE subject_id = $1 AND event_code = 'JOB_QUEUED') AS audit_events,
           (SELECT count(*)::integer FROM audit.events
             WHERE subject_id = $1
               AND metadata::text ~* '(input_sha256|input_reference|idempotency|hash)') AS leaked`,
        [created.id],
      );
      assert.deepEqual(evidence.rows[0], { jobs: 1, audit_events: 1, leaked: 0 });
    } finally {
      await cleanupGreenHiveFixtures(client).catch(() => undefined);
      await client.end();
    }
  },
);
