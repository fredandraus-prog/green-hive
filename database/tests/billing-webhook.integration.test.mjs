import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import {
  BillingError,
  BillingService,
  BillingWebhookService,
  FakeBillingWebhookVerifier,
  PostgresBillingRepository,
  PostgresBillingWebhookRepository,
} from '../../packages/billing/dist/index.js';
import { loadMigrationCatalog } from '../../scripts/lib/migration-catalog.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const USER_ID = '10000000-0000-4000-8000-000000000001';
const ORGANIZATION_ID = '30000000-0000-4000-8000-000000000001';
const REFERENCE_APP_ID = '00000000-0000-4000-8000-000000000001';
const REFERENCE_PRICE_ID = '50000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000093';
const SECRET = Buffer.alloc(32, 11);
const NOW = 1_800_000_000_000;

const authShim = `
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION auth.jwt()
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog
  AS $$
  DECLARE raw_claims text;
  BEGIN
    raw_claims := current_setting('request.jwt.claims', true);
    IF raw_claims IS NULL OR btrim(raw_claims) = '' THEN RETURN '{}'::jsonb; END IF;
    BEGIN RETURN raw_claims::jsonb;
    EXCEPTION WHEN invalid_text_representation THEN RETURN '{}'::jsonb;
    END;
  END;
  $$;
  CREATE FUNCTION auth.uid()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SET search_path = ''
  AS $$ SELECT nullif(auth.jwt() ->> 'sub', '')::uuid; $$;
  CREATE ROLE authenticated
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  GRANT USAGE ON SCHEMA auth TO authenticated;
  GRANT EXECUTE ON FUNCTION auth.jwt() TO authenticated;
  GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
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
  for (const seedFile of (await readdir(seedsDirectory)).filter((name) => name.endsWith('.sql')).sort()) {
    await database.exec(await readFile(path.join(seedsDirectory, seedFile), 'utf8'));
  }
  await database.exec(
    await readFile(
      path.join(repositoryRoot, 'database', 'tests', 'fixtures', '0001_rls_identities.sql'),
      'utf8',
    ),
  );
}

async function setContext(database) {
  await database.query(
    `SELECT
       set_config('request.jwt.claims', $1, false),
       set_config('request.green_hive.organization_id', $2, false)`,
    [
      JSON.stringify({
        sub: USER_ID,
        app_metadata: { app_code: 'REFERENCE_APP', platform_role: 'USER' },
      }),
      ORGANIZATION_ID,
    ],
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

test('verified provider events have one payment and audit effect across duplicate delivery', async () => {
  const database = new PGlite({ extensions: { pgcrypto } });
  await database.waitReady;
  try {
    await database.exec(authShim);
    await applyMigrations(database);
    await applySeedsAndFixtures(database);
    await database.exec('SET ROLE authenticated;');
    await setContext(database);
    await database.query(
      `INSERT INTO hive.projects (id, organization_id, app_id, owner_user_id, name)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Webhook Integration Project')`,
      [PROJECT_ID, ORGANIZATION_ID, REFERENCE_APP_ID, USER_ID],
    );

    const billingRepository = new PostgresBillingRepository({
      query(sql, parameters = []) {
        return database.query(sql, parameters);
      },
    });
    const billingService = new BillingService(billingRepository);
    const context = {
      userId: USER_ID,
      appCode: 'REFERENCE_APP',
      organizationId: ORGANIZATION_ID,
    };
    const purchase = await billingService.createPurchase(context, {
      projectId: PROJECT_ID,
      productCode: 'REFERENCE_APP_SANDBOX',
      priceId: REFERENCE_PRICE_ID,
      idempotencyKey: 'billing-webhook-integration-0001',
    });

    await assert.rejects(
      database.query(
        `SELECT * FROM hive.apply_verified_payment_webhook(
           'GREEN_HIVE_FAKE', 'evt_denied', 'PAYMENT_PAID', $1::uuid,
           'pay_denied', $2::text, NULL, NULL
         )`,
        [purchase.id, '0'.repeat(64)],
      ),
      /permission denied|privilege/i,
    );
    await assert.rejects(
      database.query('SELECT * FROM hive.payment_provider_events'),
      /permission denied|privilege/i,
    );

    await database.exec('RESET ROLE;');
    const webhookRepository = new PostgresBillingWebhookRepository({
      query(sql, parameters = []) {
        return database.query(sql, parameters);
      },
    });
    const webhookService = new BillingWebhookService(webhookRepository, [
      new FakeBillingWebhookVerifier({ secret: SECRET, now: () => NOW }),
    ]);
    const paidPayload = {
      eventId: 'evt_paid_integration_0001',
      type: 'PAYMENT_PAID',
      purchaseId: purchase.id,
      providerPaymentId: 'pay_integration_0001',
    };
    const paidDelivery = signedDelivery(paidPayload);
    const first = await webhookService.process('GREEN_HIVE_FAKE', paidDelivery);
    const duplicate = await webhookService.process('GREEN_HIVE_FAKE', paidDelivery);
    assert.equal(first.effect, 'PAYMENT_CONFIRMED');
    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.deliveryCount, 2);

    const paidState = await database.query(
      `SELECT purchase.status AS purchase_status, payment.status AS payment_status
       FROM hive.purchases AS purchase
       JOIN hive.payments AS payment ON payment.purchase_id = purchase.id
       WHERE purchase.id = $1::uuid`,
      [purchase.id],
    );
    assert.deepEqual(paidState.rows, [{ purchase_status: 'CONFIRMED', payment_status: 'PAID' }]);

    const paidEffects = await database.query(
      `SELECT count(*)::integer AS count
       FROM audit.events
       WHERE subject_id = $1::uuid AND event_code = 'PAYMENT_CONFIRMED'`,
      [purchase.payment.id],
    );
    assert.equal(paidEffects.rows[0].count, 1);

    await assert.rejects(
      webhookService.process(
        'GREEN_HIVE_FAKE',
        signedDelivery({ ...paidPayload, providerPaymentId: 'pay_conflict_0001' }),
      ),
      (error) =>
        error instanceof BillingError && error.code === 'BILLING_WEBHOOK_IDEMPOTENCY_CONFLICT',
    );

    const refundPayload = {
      eventId: 'evt_refund_integration_0001',
      type: 'PAYMENT_REFUNDED',
      purchaseId: purchase.id,
      providerPaymentId: 'pay_integration_0001',
      providerRefundId: 'refund_integration_0001',
    };
    const refundDelivery = signedDelivery(refundPayload);
    assert.equal(
      (await webhookService.process('GREEN_HIVE_FAKE', refundDelivery)).effect,
      'PAYMENT_REFUNDED',
    );
    assert.equal(
      (await webhookService.process('GREEN_HIVE_FAKE', refundDelivery)).duplicate,
      true,
    );

    const providerEvents = await database.query(
      `SELECT provider_event_id, effect, delivery_count, length(payload_sha256) AS hash_length
       FROM hive.payment_provider_events
       WHERE purchase_id = $1::uuid
       ORDER BY provider_event_id`,
      [purchase.id],
    );
    assert.deepEqual(providerEvents.rows, [
      {
        provider_event_id: 'evt_paid_integration_0001',
        effect: 'PAYMENT_CONFIRMED',
        delivery_count: 2,
        hash_length: 64,
      },
      {
        provider_event_id: 'evt_refund_integration_0001',
        effect: 'PAYMENT_REFUNDED',
        delivery_count: 2,
        hash_length: 64,
      },
    ]);
    const auditEffects = await database.query(
      `SELECT event_code, count(*)::integer AS count
       FROM audit.events
       WHERE subject_id = $1::uuid
       GROUP BY event_code
       ORDER BY event_code`,
      [purchase.payment.id],
    );
    assert.deepEqual(auditEffects.rows, [
      { event_code: 'PAYMENT_CONFIRMED', count: 1 },
      { event_code: 'PAYMENT_REFUNDED', count: 1 },
    ]);

    const failurePurchase = await billingService.createPurchase(context, {
      projectId: PROJECT_ID,
      productCode: 'REFERENCE_APP_SANDBOX',
      priceId: REFERENCE_PRICE_ID,
      idempotencyKey: 'billing-webhook-integration-failure-0001',
    });
    const failureDelivery = signedDelivery({
      eventId: 'evt_failure_integration_0001',
      type: 'PAYMENT_FAILED',
      purchaseId: failurePurchase.id,
      providerPaymentId: 'pay_failure_integration_0001',
      failureCode: 'SANDBOX_DECLINED',
    });
    assert.equal(
      (await webhookService.process('GREEN_HIVE_FAKE', failureDelivery)).effect,
      'PAYMENT_FAILED',
    );
    assert.equal(
      (await webhookService.process('GREEN_HIVE_FAKE', failureDelivery)).duplicate,
      true,
    );
    const failedState = await database.query(
      `SELECT
         purchase.status AS purchase_status,
         payment.status AS payment_status,
         payment.failure_code,
         provider_event.delivery_count,
         count(audit_event.id)::integer AS audit_count
       FROM hive.purchases AS purchase
       JOIN hive.payments AS payment ON payment.purchase_id = purchase.id
       JOIN hive.payment_provider_events AS provider_event
         ON provider_event.payment_id = payment.id
       LEFT JOIN audit.events AS audit_event
         ON audit_event.subject_id = payment.id
        AND audit_event.event_code = 'PAYMENT_FAILED'
       WHERE purchase.id = $1::uuid
       GROUP BY purchase.status, payment.status, payment.failure_code, provider_event.delivery_count`,
      [failurePurchase.id],
    );
    assert.deepEqual(failedState.rows, [{
      purchase_status: 'CANCELED',
      payment_status: 'FAILED',
      failure_code: 'SANDBOX_DECLINED',
      delivery_count: 2,
      audit_count: 1,
    }]);

    const forbiddenColumns = await database.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'hive'
         AND table_name = 'payment_provider_events'
         AND column_name IN ('raw_payload', 'raw_body', 'signature')`,
    );
    assert.deepEqual(forbiddenColumns.rows, []);
  } finally {
    await database.close();
  }
});
