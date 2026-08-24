import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import pg from 'pg';
import {
  BillingError,
  BillingService,
  BillingWebhookService,
  FakeBillingWebhookVerifier,
  PostgresBillingRepository,
  PostgresBillingWebhookRepository,
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
import {
  ORGANIZATION_A_ID,
  REFERENCE_APP_ID,
  REFERENCE_PRICE_ID,
  USER_A_ID,
} from './helpers/rls-matrix.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const databaseUrl = process.env.GREEN_HIVE_TEST_DATABASE_URL;
const confirmation = process.env.GREEN_HIVE_TEST_CONFIRM;
const target = process.env.GREEN_HIVE_TEST_TARGET;
const isStaging = target === SUPABASE_STAGING_TARGET;
const PROJECT_ID = '20000000-0000-4000-8000-000000000103';
const SECRET = Buffer.alloc(32, 13);
const NOW = 1_800_000_000_000;

function claims() {
  return JSON.stringify({
    sub: USER_A_ID,
    app_metadata: { app_code: 'REFERENCE_APP', platform_role: 'USER' },
  });
}

async function setContext(client) {
  await client.query(
    `SELECT
       set_config('request.jwt.claims', $1, false),
       set_config('request.green_hive.organization_id', $2, false)`,
    [claims(), ORGANIZATION_A_ID],
  );
}

function signedDelivery(payload) {
  const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
  const timestamp = Math.floor(NOW / 1000);
  const digest = createHmac('sha256', SECRET)
    .update(Buffer.from(`${timestamp}.`, 'utf8'))
    .update(rawBody)
    .digest('hex');
  return { rawBody, signature: `t=${timestamp},v1=${digest}` };
}

function processor(client) {
  return new BillingWebhookService(
    new PostgresBillingWebhookRepository({
      query: (sql, parameters) => client.query(sql, parameters),
    }),
    [new FakeBillingWebhookVerifier({ secret: SECRET, now: () => NOW })],
  );
}

test(
  'GH-0303 verified idempotent payment webhooks on native Supabase',
  { skip: !databaseUrl || !confirmation ? 'Supabase gate not configured' : false },
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
      await cleanupGreenHiveFixtures(client);
      await client.query(
        await readFile(
          path.join(repositoryRoot, 'database', 'tests', 'fixtures', '0001_rls_identities.sql'),
          'utf8',
        ),
      );
      await client.query('SET ROLE authenticated');
      await setContext(client);
      await client.query(
        `INSERT INTO hive.projects (id, organization_id, app_id, owner_user_id, name)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Native Webhook Project')`,
        [PROJECT_ID, ORGANIZATION_A_ID, REFERENCE_APP_ID, USER_A_ID],
      );
      const billingService = new BillingService(
        new PostgresBillingRepository({
          query: (sql, parameters) => client.query(sql, parameters),
        }),
      );
      const purchase = await billingService.createPurchase(
        {
          userId: USER_A_ID,
          appCode: 'REFERENCE_APP',
          organizationId: ORGANIZATION_A_ID,
        },
        {
          projectId: PROJECT_ID,
          productCode: 'REFERENCE_APP_SANDBOX',
          priceId: REFERENCE_PRICE_ID,
          idempotencyKey: 'native-webhook-concurrent-0001',
        },
      );
      await assert.rejects(
        client.query('SELECT * FROM hive.payment_provider_events'),
        /permission denied|privilege/i,
      );
      await assert.rejects(
        client.query(
          `SELECT * FROM hive.apply_verified_payment_webhook(
             'GREEN_HIVE_FAKE', 'evt_denied', 'PAYMENT_PAID', $1::uuid,
             'pay_denied', $2::text, NULL, NULL
           )`,
          [purchase.id, '0'.repeat(64)],
        ),
        /permission denied|privilege/i,
      );
      await client.query('RESET ROLE');

      const peer = new pg.Client({ connectionString: databaseUrl });
      await peer.connect();
      try {
        const delivery = signedDelivery({
          eventId: 'evt_native_concurrent_0001',
          type: 'PAYMENT_PAID',
          purchaseId: purchase.id,
          providerPaymentId: 'pay_native_concurrent_0001',
        });
        const results = await Promise.all([
          processor(client).process('GREEN_HIVE_FAKE', delivery),
          processor(peer).process('GREEN_HIVE_FAKE', delivery),
        ]);
        assert.deepEqual(
          results.map((result) => result.duplicate).sort(),
          [false, true],
        );
        assert.deepEqual(new Set(results.map((result) => result.eventRecordId)).size, 1);

        await assert.rejects(
          processor(client).process(
            'GREEN_HIVE_FAKE',
            signedDelivery({
              eventId: 'evt_native_concurrent_0001',
              type: 'PAYMENT_PAID',
              purchaseId: purchase.id,
              providerPaymentId: 'pay_native_conflict_0001',
            }),
          ),
          (error) =>
            error instanceof BillingError &&
            error.code === 'BILLING_WEBHOOK_IDEMPOTENCY_CONFLICT',
        );
      } finally {
        await peer.end();
      }

      const evidence = await client.query(
        `SELECT
           purchase.status AS purchase_status,
           payment.status AS payment_status,
           provider_event.delivery_count,
           provider_event.effect,
           length(provider_event.payload_sha256) AS hash_length,
           count(audit_event.id)::integer AS audit_count
         FROM hive.purchases AS purchase
         JOIN hive.payments AS payment ON payment.purchase_id = purchase.id
         JOIN hive.payment_provider_events AS provider_event
           ON provider_event.payment_id = payment.id
         LEFT JOIN audit.events AS audit_event
           ON audit_event.subject_id = payment.id
          AND audit_event.event_code = 'PAYMENT_CONFIRMED'
         WHERE purchase.id = $1::uuid
         GROUP BY
           purchase.status,
           payment.status,
           provider_event.delivery_count,
           provider_event.effect,
           provider_event.payload_sha256`,
        [purchase.id],
      );
      assert.deepEqual(evidence.rows, [{
        purchase_status: 'CONFIRMED',
        payment_status: 'PAID',
        delivery_count: 2,
        effect: 'PAYMENT_CONFIRMED',
        hash_length: 64,
        audit_count: 1,
      }]);
      const forbiddenColumns = await client.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'hive'
           AND table_name = 'payment_provider_events'
           AND column_name IN ('raw_payload', 'raw_body', 'signature')`,
      );
      assert.deepEqual(forbiddenColumns.rows, []);
    } finally {
      await cleanupGreenHiveFixtures(client).catch(() => undefined);
      await client.end();
    }
  },
);
