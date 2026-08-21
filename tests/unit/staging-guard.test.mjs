import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertSupabaseStagingDatabaseConfiguration,
  assertSupabaseStagingConfiguration,
  SUPABASE_STAGING_CONFIRMATION,
  SUPABASE_STAGING_TARGET,
} from '../../scripts/lib/staging-guard.mjs';

const projectRef = 'abcdefghijklmnopqrst';
const valid = Object.freeze({
  projectRef,
  projectName: 'green-hive-staging',
  region: 'sa-east-1',
  target: SUPABASE_STAGING_TARGET,
  confirmation: SUPABASE_STAGING_CONFIRMATION,
  appOrigin: 'https://staging.green-hive.example',
  authUrl: `https://${projectRef}.supabase.co/auth/v1`,
  recoveryRedirect: 'https://staging.green-hive.example/auth/recovery',
  databaseUrl:
    `postgresql://postgres:secret@db.${projectRef}.supabase.co:5432/` +
    'postgres?sslmode=verify-full',
});

test('staging guard accepts the canonical direct Supabase connection', () => {
  const configuration = assertSupabaseStagingConfiguration(valid);
  assert.equal(configuration.projectRef, projectRef);
  assert.equal(configuration.databaseUrl.hostname, `db.${projectRef}.supabase.co`);
});

test('database-only staging guard does not accept or require a fictitious HTTPS host', () => {
  const configuration = assertSupabaseStagingDatabaseConfiguration({
    projectRef: valid.projectRef,
    projectName: valid.projectName,
    region: valid.region,
    target: valid.target,
    confirmation: valid.confirmation,
    databaseUrl: valid.databaseUrl,
  });
  assert.equal(configuration.projectRef, projectRef);
  assert.equal('appOrigin' in configuration, false);
});

test('staging guard accepts a session pooler tied to the same project', () => {
  const configuration = assertSupabaseStagingConfiguration({
    ...valid,
    databaseUrl:
      `postgresql://postgres.${projectRef}:secret@aws-0-sa-east-1.pooler.supabase.com:5432/` +
      'postgres?sslmode=verify-full',
  });
  assert.match(configuration.databaseUrl.hostname, /pooler\.supabase\.com$/);
});

test('staging guard rejects local, cross-project and non-TLS databases', () => {
  assert.throws(
    () =>
      assertSupabaseStagingConfiguration({
        ...valid,
        databaseUrl:
          'postgresql://postgres:postgres@127.0.0.1:5432/postgres?sslmode=verify-full',
      }),
    /does not belong/,
  );
  assert.throws(
    () =>
      assertSupabaseStagingConfiguration({
        ...valid,
        databaseUrl:
          'postgresql://postgres:secret@db.zzzzzzzzzzzzzzzzzzzz.supabase.co:5432/' +
          'postgres?sslmode=verify-full',
      }),
    /does not belong/,
  );
  assert.throws(
    () =>
      assertSupabaseStagingConfiguration({
        ...valid,
        databaseUrl: `postgresql://postgres:secret@db.${projectRef}.supabase.co:5432/postgres`,
      }),
    /verify-full/,
  );
});

test('staging guard rejects transaction poolers and incorrect confirmations', () => {
  assert.throws(
    () =>
      assertSupabaseStagingConfiguration({
        ...valid,
        databaseUrl:
          `postgresql://postgres.${projectRef}:secret@aws-0-sa-east-1.pooler.supabase.com:6543/` +
          'postgres?sslmode=verify-full',
      }),
    /port 5432/,
  );
  assert.throws(
    () => assertSupabaseStagingConfiguration({ ...valid, confirmation: 'YES' }),
    /GREEN_HIVE_DEDICATED_STAGING/,
  );
});

test('staging guard requires exact HTTPS app, Auth and recovery URLs', () => {
  assert.throws(
    () => assertSupabaseStagingConfiguration({ ...valid, appOrigin: 'http://example.test' }),
    /https/,
  );
  assert.throws(
    () =>
      assertSupabaseStagingConfiguration({
        ...valid,
        authUrl: 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co/auth/v1',
      }),
    /canonical hosted GoTrue/,
  );
  assert.throws(
    () =>
      assertSupabaseStagingConfiguration({
        ...valid,
        recoveryRedirect: 'https://staging.green-hive.example/auth/recovery/extra',
      }),
    /exact HTTPS/,
  );
});
