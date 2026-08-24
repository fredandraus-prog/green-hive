import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createReferenceAppReadinessCheck,
  referenceAppRuntimeConfiguration,
} from '../../apps/hive-reference-app/dist/index.js';

const projectRef = 'rabkyesatfuezmrrzllx';
const hostedEnvironment = Object.freeze({
  NODE_ENV: 'production',
  NODE_EXTRA_CA_CERTS: './config/supabase-root-2021-ca.crt',
  GREEN_HIVE_RUNTIME_MODE: 'HOSTED_STAGING',
  GREEN_HIVE_APP_ORIGIN: 'https://green-hive-staging.onrender.com',
  DATABASE_URL:
    `postgresql://postgres.${projectRef}:example-password@` +
    'aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full',
  GREEN_HIVE_SUPABASE_AUTH_URL: `https://${projectRef}.supabase.co/auth/v1`,
  GREEN_HIVE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example_value',
  GREEN_HIVE_SUPABASE_SERVICE_ROLE_KEY: 'sb_example_server_only_value',
  GREEN_HIVE_FAKE_WEBHOOK_SECRET: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  GREEN_HIVE_AUTH_RECOVERY_REDIRECT:
    'https://green-hive-staging.onrender.com/auth/recovery',
  GREEN_HIVE_STAGING_PROJECT_REF: projectRef,
  GREEN_HIVE_HTTP_LOGS: 'true',
  GREEN_HIVE_DATABASE_POOL_MAX: '5',
  PORT: '10000',
});

test('hosted runtime binds Render safely and derives no authority from client input', () => {
  const configuration = referenceAppRuntimeConfiguration(hostedEnvironment);
  assert.equal(configuration.mode, 'HOSTED_STAGING');
  assert.equal(configuration.bindHost, '0.0.0.0');
  assert.equal(configuration.bindPort, 10000);
  assert.equal(configuration.secureCookies, true);
  assert.equal(configuration.poolMax, 5);
  assert.equal(configuration.appOrigin.origin, hostedEnvironment.GREEN_HIVE_APP_ORIGIN);
});

test('hosted runtime rejects local endpoints, wrong projects, callbacks, TLS and ports', () => {
  const invalid = [
    [{ NODE_ENV: 'development' }, /NODE_ENV=production/],
    [{ NODE_EXTRA_CA_CERTS: './config/other-ca.crt' }, /canonical Supabase root CA/],
    [{ GREEN_HIVE_APP_ORIGIN: 'http://127.0.0.1:3000' }, /https/],
    [{ GREEN_HIVE_AUTH_RECOVERY_REDIRECT: 'https://other.example/auth/recovery' }, /exact/],
    [{ GREEN_HIVE_SUPABASE_AUTH_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co/auth/v1' }, /confirmed/],
    [{ DATABASE_URL: hostedEnvironment.DATABASE_URL.replace('verify-full', 'require') }, /verify-full/],
    [{ DATABASE_URL: hostedEnvironment.DATABASE_URL.replace(projectRef, 'aaaaaaaaaaaaaaaaaaaa') }, /confirmed/],
    [{ PORT: '18012' }, /reserved/],
    [{ PORT: 'not-a-port' }, /integer/],
  ];
  for (const [change, expected] of invalid) {
    assert.throws(
      () => referenceAppRuntimeConfiguration({ ...hostedEnvironment, ...change }),
      expected,
    );
  }
});

test('local runtime remains restricted to the canonical loopback preview', () => {
  const local = {
    NODE_ENV: 'development',
    GREEN_HIVE_RUNTIME_MODE: 'LOCAL_PREVIEW',
    GREEN_HIVE_APP_ORIGIN: 'http://127.0.0.1:3000',
    DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    GREEN_HIVE_SUPABASE_AUTH_URL: 'http://127.0.0.1:54321',
    GREEN_HIVE_SUPABASE_PUBLISHABLE_KEY: 'local-publishable',
    GREEN_HIVE_SUPABASE_SERVICE_ROLE_KEY: 'local-server-only',
    GREEN_HIVE_FAKE_WEBHOOK_SECRET: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    GREEN_HIVE_AUTH_RECOVERY_REDIRECT: 'http://127.0.0.1:3000/auth/recovery',
    GREEN_HIVE_HTTP_LOGS: 'false',
  };
  const configuration = referenceAppRuntimeConfiguration(local);
  assert.equal(configuration.bindHost, '127.0.0.1');
  assert.equal(configuration.bindPort, 3000);
  assert.equal(configuration.secureCookies, false);
  assert.throws(
    () => referenceAppRuntimeConfiguration({ ...local, GREEN_HIVE_APP_ORIGIN: 'http://localhost:3000' }),
    /canonical loopback/,
  );
  assert.throws(
    () => referenceAppRuntimeConfiguration({ ...local, GREEN_HIVE_SUPABASE_AUTH_URL: 'http://127.0.0.1:54321/other' }),
    /canonical loopback/,
  );
});

test('readiness requires the full migration, seed and helper contract', async () => {
  const readyState = {
    migration_count: 16,
    migration_version: 16,
    reference_app_count: 1,
    reference_product_count: 1,
    reference_price_count: 1,
    projects_ready: true,
    audit_ready: true,
    billing_catalog_ready: true,
    billing_purchase_ready: true,
    billing_function_ready: true,
    billing_provider_ready: true,
    billing_webhook_ready: true,
    entitlement_mapping_count: 2,
    entitlements_ready: true,
    app_helper_ready: true,
    organization_helper_ready: true,
  };
  const calls = [];
  const ready = createReferenceAppReadinessCheck({
    async query(text, values) {
      calls.push([text, values]);
      return { rows: [readyState] };
    },
  });
  await ready();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], [
    '00000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
  ]);

  const notReady = createReferenceAppReadinessCheck({
    async query() {
      return { rows: [{ ...readyState, billing_function_ready: false }] };
    },
  });
  await assert.rejects(notReady, /database baseline is not ready/);
});
