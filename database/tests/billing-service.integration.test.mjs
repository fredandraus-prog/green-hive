import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import {
  BillingError,
  BillingService,
  FakeBillingProvider,
  PostgresBillingRepository,
} from '../../packages/billing/dist/index.js';
import { loadMigrationCatalog } from '../../scripts/lib/migration-catalog.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const USER_A_ID = '10000000-0000-4000-8000-000000000001';
const USER_B_ID = '10000000-0000-4000-8000-000000000002';
const ORGANIZATION_A_ID = '30000000-0000-4000-8000-000000000001';
const ORGANIZATION_B_ID = '30000000-0000-4000-8000-000000000002';
const REFERENCE_APP_ID = '00000000-0000-4000-8000-000000000001';
const REFERENCE_PRICE_ID = '50000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000091';
const FAILED_PROJECT_ID = '20000000-0000-4000-8000-000000000092';

const authShim = `
  CREATE SCHEMA auth;
  CREATE SCHEMA storage;
  CREATE TABLE storage.buckets (
    id text PRIMARY KEY,
    name text NOT NULL,
    public boolean NOT NULL DEFAULT false
  );
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
    const sql = await readFile(path.join(seedsDirectory, seedFile), 'utf8');
    await database.exec(`BEGIN;\n${sql}\nCOMMIT;`);
  }
  const fixture = await readFile(
    path.join(repositoryRoot, 'database', 'tests', 'fixtures', '0001_rls_identities.sql'),
    'utf8',
  );
  await database.exec(`BEGIN;\n${fixture}\nCOMMIT;`);
}

async function setContext(database, userId, appCode, organizationId, platformRole = 'USER') {
  const claims = JSON.stringify({
    sub: userId,
    app_metadata: { app_code: appCode, platform_role: platformRole },
  });
  await database.query(
    `SELECT
       set_config('request.jwt.claims', $1, false),
       set_config('request.green_hive.organization_id', $2, false)`,
    [claims, organizationId ?? ''],
  );
}

function hasCode(code) {
  return (error) => error instanceof BillingError && error.code === code;
}

test('Postgres Billing repository preserves trusted scope, decimal snapshots and idempotency', async () => {
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
       VALUES
         ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Billing Integration Project'),
         ($5::uuid, $2::uuid, $3::uuid, $4::uuid, 'Failed Billing Integration Project')`,
      [PROJECT_ID, ORGANIZATION_A_ID, REFERENCE_APP_ID, USER_A_ID, FAILED_PROJECT_ID],
    );

    const repository = new PostgresBillingRepository({
      query(sql, parameters = []) {
        return database.query(sql, parameters);
      },
    });
    const service = new BillingService(
      repository,
      new FakeBillingProvider({ paymentOutcome: 'SUCCESS' }),
    );
    const contextA = {
      userId: USER_A_ID,
      appCode: 'REFERENCE_APP',
      organizationId: ORGANIZATION_A_ID,
    };

    const catalog = await service.listCatalog(contextA);
    assert.deepEqual(catalog.map((product) => product.productCode), ['REFERENCE_APP_SANDBOX']);
    assert.equal(catalog[0].prices[0].amount, '0.000000');

    const input = {
      projectId: PROJECT_ID,
      productCode: 'REFERENCE_APP_SANDBOX',
      priceId: REFERENCE_PRICE_ID,
      idempotencyKey: 'billing-integration-0001',
    };
    const purchase = await service.createPurchase(contextA, input);
    const repeated = await service.createPurchase(contextA, input);
    assert.equal(repeated.id, purchase.id);
    assert.equal(repeated.payment.id, purchase.payment.id);
    assert.equal(purchase.amount, '0.000000');
    assert.equal(purchase.payment.amount, '0.000000');
    assert.equal(purchase.status, 'PENDING');
    assert.equal(purchase.payment.status, 'PENDING');
    assert.deepEqual((await service.listPurchases(contextA, PROJECT_ID)).map((row) => row.id), [purchase.id]);

    await assert.rejects(
      database.query(
        `SELECT hive.apply_provider_payment_result(
           $1::uuid,
           'GREEN_HIVE_FAKE',
           $2::text,
           'PAID',
           NULL
         )`,
        [purchase.id, `fake-payment:${purchase.payment.id}`],
      ),
      /permission denied|privilege/i,
    );

    await database.exec('RESET ROLE;');
    const paid = await service.processPayment(contextA, purchase.id);
    assert.equal(paid.status, 'CONFIRMED');
    assert.equal(paid.payment.status, 'PAID');
    assert.equal((await service.processPayment(contextA, purchase.id)).payment.status, 'PAID');

    const refunded = await service.refundPayment(contextA, purchase.id);
    assert.equal(refunded.status, 'CONFIRMED');
    assert.equal(refunded.payment.status, 'REFUNDED');
    assert.equal(refunded.payment.refundedAmount, refunded.payment.amount);
    assert.equal((await service.refundPayment(contextA, purchase.id)).payment.status, 'REFUNDED');

    const audit = await database.query(
      `SELECT event_code, outcome, metadata
       FROM audit.events
       WHERE subject_id = $1::uuid
       ORDER BY occurred_at, event_code`,
      [purchase.payment.id],
    );
    assert.deepEqual(audit.rows, [
      {
        event_code: 'PAYMENT_CONFIRMED',
        outcome: 'SUCCEEDED',
        metadata: { provider_code: 'GREEN_HIVE_FAKE', status: 'PAID' },
      },
      {
        event_code: 'PAYMENT_REFUNDED',
        outcome: 'SUCCEEDED',
        metadata: { provider_code: 'GREEN_HIVE_FAKE', status: 'REFUNDED' },
      },
    ]);

    const failureService = new BillingService(
      repository,
      new FakeBillingProvider({ paymentOutcome: 'FAILURE' }),
    );
    const failurePurchase = await failureService.createPurchase(contextA, {
      projectId: FAILED_PROJECT_ID,
      productCode: 'REFERENCE_APP_SANDBOX',
      priceId: REFERENCE_PRICE_ID,
      idempotencyKey: 'billing-integration-failure-0001',
    });
    const failed = await failureService.processPayment(contextA, failurePurchase.id);
    assert.equal(failed.status, 'CANCELED');
    assert.equal(failed.payment.status, 'FAILED');
    assert.equal(
      (await failureService.processPayment(contextA, failurePurchase.id)).payment.status,
      'FAILED',
    );
    await assert.rejects(
      failureService.refundPayment(contextA, failurePurchase.id),
      hasCode('INVALID_PAYMENT_TRANSITION'),
    );
    await assert.rejects(
      database.query(
        `SELECT hive.apply_provider_payment_result(
           $1::uuid,
           'GREEN_HIVE_FAKE',
           $2::text,
           'PAID',
           NULL
         )`,
        [failurePurchase.id, `fake-payment:${failurePurchase.payment.id}`],
      ),
      /INVALID_PAYMENT_TRANSITION/,
    );
    const failureAudit = await database.query(
      `SELECT event_code, outcome, metadata
       FROM audit.events
       WHERE subject_id = $1::uuid`,
      [failurePurchase.payment.id],
    );
    assert.deepEqual(failureAudit.rows, [
      {
        event_code: 'PAYMENT_FAILED',
        outcome: 'FAILED',
        metadata: {
          failure_code: 'SANDBOX_DECLINED',
          provider_code: 'GREEN_HIVE_FAKE',
          status: 'FAILED',
        },
      },
    ]);

    await database.exec('SET ROLE authenticated;');

    await setContext(database, USER_B_ID, 'REFERENCE_APP', ORGANIZATION_B_ID);
    const contextB = {
      userId: USER_B_ID,
      appCode: 'REFERENCE_APP',
      organizationId: ORGANIZATION_B_ID,
    };
    await assert.rejects(service.getPurchase(contextB, purchase.id), hasCode('PURCHASE_NOT_FOUND'));

    await setContext(database, USER_A_ID, 'OTHER_TEST_APP', ORGANIZATION_A_ID);
    const otherAppContext = { ...contextA, appCode: 'OTHER_TEST_APP' };
    assert.deepEqual(await service.listCatalog(otherAppContext), []);

    await setContext(database, USER_A_ID, 'REFERENCE_APP', null, 'PLATFORM_ADMIN');
    await assert.rejects(
      service.listCatalog({ ...contextA, platformRole: 'PLATFORM_ADMIN' }),
      hasCode('BILLING_ACCESS_DENIED'),
    );
  } finally {
    await database.close();
  }
});
