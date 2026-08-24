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
  EntitlementError,
  EntitlementService,
  PostgresEntitlementRepository,
} from '../../packages/entitlements/dist/index.js';
import { loadMigrationCatalog } from '../../scripts/lib/migration-catalog.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const USER_A_ID = '10000000-0000-4000-8000-000000000001';
const USER_B_ID = '10000000-0000-4000-8000-000000000002';
const ADMIN_ID = '10000000-0000-4000-8000-000000000003';
const ORGANIZATION_A_ID = '30000000-0000-4000-8000-000000000001';
const ORGANIZATION_B_ID = '30000000-0000-4000-8000-000000000002';
const REFERENCE_APP_ID = '00000000-0000-4000-8000-000000000001';
const REFERENCE_PRICE_ID = '50000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000094';

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

async function setContext(database, userId, appCode, organizationId, platformRole = 'USER') {
  await database.query(
    `SELECT
       set_config('request.jwt.claims', $1, false),
       set_config('request.green_hive.organization_id', $2, false)`,
    [
      JSON.stringify({
        sub: userId,
        app_metadata: { app_code: appCode, platform_role: platformRole },
      }),
      organizationId ?? '',
    ],
  );
}

function hasEntitlementCode(code) {
  return (error) => error instanceof EntitlementError && error.code === code;
}

test('paid purchase grants server-authoritative capabilities and refund revokes its own grants', async () => {
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
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Entitlement Integration Project')`,
      [PROJECT_ID, ORGANIZATION_A_ID, REFERENCE_APP_ID, USER_A_ID],
    );

    const executor = {
      query(sql, parameters = []) {
        return database.query(sql, parameters);
      },
    };
    const billing = new BillingService(
      new PostgresBillingRepository(executor),
      new FakeBillingProvider({ paymentOutcome: 'SUCCESS' }),
    );
    const entitlements = new EntitlementService(new PostgresEntitlementRepository(executor));
    const contextA = {
      userId: USER_A_ID,
      appCode: 'REFERENCE_APP',
      organizationId: ORGANIZATION_A_ID,
    };
    const input = {
      projectId: PROJECT_ID,
      productCode: 'REFERENCE_APP_SANDBOX',
      priceId: REFERENCE_PRICE_ID,
      idempotencyKey: 'entitlement-integration-0001',
    };

    const first = await billing.createPurchase(contextA, input);
    assert.equal(await entitlements.can(contextA, PROJECT_ID, 'REFERENCE_APP_RUN_JOB'), false);
    assert.deepEqual(await entitlements.list(contextA, PROJECT_ID), []);
    await assert.rejects(
      database.query('SELECT hive.apply_entitlement_state_for_purchase($1::uuid)', [first.id]),
      /permission denied|privilege/i,
    );
    await assert.rejects(
      database.query(
        `INSERT INTO hive.project_entitlements (
           organization_id, app_id, project_id, owner_user_id, product_id,
           purchase_id, payment_id, product_code, price_version,
           capability_code, status, granted_at
         ) VALUES (
           $1::uuid, $2::uuid, $3::uuid, $4::uuid,
           '40000000-0000-4000-8000-000000000001'::uuid,
           $5::uuid, $6::uuid, 'REFERENCE_APP_SANDBOX', 1,
           'REFERENCE_APP_RUN_JOB', 'ACTIVE', now()
         )`,
        [ORGANIZATION_A_ID, REFERENCE_APP_ID, PROJECT_ID, USER_A_ID, first.id, first.payment.id],
      ),
      /permission denied|privilege/i,
    );

    await database.exec('RESET ROLE;');
    await billing.processPayment(contextA, first.id);
    await database.exec('SET ROLE authenticated;');
    await setContext(database, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);

    assert.equal(await entitlements.can(contextA, PROJECT_ID, 'REFERENCE_APP_RUN_JOB'), true);
    assert.equal(await entitlements.can(contextA, PROJECT_ID, 'REFERENCE_APP_GENERATE_FILE'), true);
    assert.equal(await entitlements.can(contextA, PROJECT_ID, 'REFERENCE_APP_UNKNOWN'), false);
    assert.equal(await entitlements.can(contextA, PROJECT_ID, 'OTHER_TEST_APP_RUN_JOB'), false);
    const firstGrants = await entitlements.list(contextA, PROJECT_ID);
    assert.equal(firstGrants.length, 2);
    assert.ok(firstGrants.every((grant) => grant.status === 'ACTIVE'));
    assert.deepEqual(
      firstGrants.map((grant) => grant.capabilityCode).sort(),
      ['REFERENCE_APP_GENERATE_FILE', 'REFERENCE_APP_RUN_JOB'],
    );

    const second = await billing.createPurchase(contextA, {
      ...input,
      idempotencyKey: 'entitlement-integration-0002',
    });
    await database.exec('RESET ROLE;');
    await billing.processPayment(contextA, second.id);
    await billing.refundPayment(contextA, first.id);
    await database.exec('SET ROLE authenticated;');
    await setContext(database, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);

    assert.equal(await entitlements.can(contextA, PROJECT_ID, 'REFERENCE_APP_RUN_JOB'), true);
    const mixedGrants = await entitlements.list(contextA, PROJECT_ID);
    assert.equal(mixedGrants.filter((grant) => grant.status === 'ACTIVE').length, 2);
    assert.equal(mixedGrants.filter((grant) => grant.status === 'REVOKED').length, 2);

    await database.exec('RESET ROLE;');
    await billing.refundPayment(contextA, second.id);
    await database.exec('SET ROLE authenticated;');
    await setContext(database, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    assert.equal(await entitlements.can(contextA, PROJECT_ID, 'REFERENCE_APP_RUN_JOB'), false);
    assert.equal((await entitlements.list(contextA, PROJECT_ID)).length, 4);

    await setContext(database, USER_B_ID, 'REFERENCE_APP', ORGANIZATION_B_ID);
    const contextB = {
      userId: USER_B_ID,
      appCode: 'REFERENCE_APP',
      organizationId: ORGANIZATION_B_ID,
    };
    assert.equal(await entitlements.can(contextB, PROJECT_ID, 'REFERENCE_APP_RUN_JOB'), false);
    assert.deepEqual(await entitlements.list(contextB, PROJECT_ID), []);

    await setContext(database, USER_A_ID, 'OTHER_TEST_APP', ORGANIZATION_A_ID);
    assert.equal(
      await entitlements.can(
        { ...contextA, appCode: 'OTHER_TEST_APP' },
        PROJECT_ID,
        'OTHER_TEST_APP_RUN_JOB',
      ),
      false,
    );

    await setContext(database, ADMIN_ID, 'REFERENCE_APP', null, 'PLATFORM_ADMIN');
    const adminRows = await database.query(
      'SELECT capability_code, status FROM hive.project_entitlements ORDER BY purchase_id, capability_code',
    );
    assert.equal(adminRows.rows.length, 4);
    await assert.rejects(
      entitlements.list({ ...contextA, platformRole: 'PLATFORM_ADMIN' }, PROJECT_ID),
      hasEntitlementCode('ENTITLEMENT_ACCESS_DENIED'),
    );

    await database.exec('RESET ROLE;');
    const audit = await database.query(
      `SELECT event_code, count(*)::integer AS occurrences
       FROM audit.events
       WHERE subject_type = 'ENTITLEMENT' AND project_id = $1::uuid
       GROUP BY event_code
       ORDER BY event_code`,
      [PROJECT_ID],
    );
    assert.deepEqual(audit.rows, [
      { event_code: 'ENTITLEMENT_CHANGED', occurrences: 4 },
      { event_code: 'ENTITLEMENT_GRANTED', occurrences: 4 },
    ]);
    assert.doesNotMatch(JSON.stringify(audit.rows), /token|secret|provider|idempotency/i);
  } finally {
    await database.close();
  }
});
