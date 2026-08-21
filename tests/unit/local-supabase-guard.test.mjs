import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertLocalSupabaseTarget,
  LOCAL_SUPABASE_CONFIRMATION,
  LOCAL_SUPABASE_DATABASE_URL,
  LOCAL_SUPABASE_TARGET,
} from '../../scripts/lib/local-supabase-guard.mjs';

const validTarget = {
  databaseUrl: LOCAL_SUPABASE_DATABASE_URL,
  target: LOCAL_SUPABASE_TARGET,
  confirmation: LOCAL_SUPABASE_CONFIRMATION,
};

test('local Supabase destructive gate accepts only the exact loopback target', () => {
  const parsed = assertLocalSupabaseTarget(validTarget);
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.equal(parsed.port, '54322');
  assert.equal(parsed.pathname, '/postgres');
});

test('local Supabase destructive gate rejects host, port, database and missing confirmations', () => {
  assert.throws(
    () =>
      assertLocalSupabaseTarget({
        ...validTarget,
        databaseUrl: 'postgresql://postgres:postgres@192.168.0.10:54322/postgres',
      }),
    /host 127\.0\.0\.1 or localhost/,
  );
  assert.throws(
    () =>
      assertLocalSupabaseTarget({
        ...validTarget,
        databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:5432/postgres',
      }),
    /port 54322/,
  );
  assert.throws(
    () =>
      assertLocalSupabaseTarget({
        ...validTarget,
        databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:54322/production',
      }),
    /database postgres/,
  );
  assert.throws(
    () => assertLocalSupabaseTarget({ ...validTarget, target: 'PRODUCTION' }),
    /GREEN_HIVE_TEST_TARGET=LOCAL_SUPABASE/,
  );
  assert.throws(
    () => assertLocalSupabaseTarget({ ...validTarget, confirmation: 'yes' }),
    /GREEN_HIVE_TEST_CONFIRM=DROP_GREEN_HIVE_TEST_SCHEMAS/,
  );
});
