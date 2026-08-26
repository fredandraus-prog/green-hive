import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { runGreenHiveDatabaseSmoke } from './lib/green-hive-smoke.mjs';
import {
  assertLocalSupabaseTarget,
  assertNativeSupabaseContract,
} from './lib/local-supabase-guard.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databaseUrl = process.env.GREEN_HIVE_TEST_DATABASE_URL;

assertLocalSupabaseTarget({
  databaseUrl,
  target: process.env.GREEN_HIVE_TEST_TARGET,
  confirmation: process.env.GREEN_HIVE_TEST_CONFIRM,
});

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  await assertNativeSupabaseContract(client);
  const result = await runGreenHiveDatabaseSmoke(client, repositoryRoot);

  console.log(
    `Supabase smoke passed: ledger=${result.ledgerRows}, REFERENCE_APP=1, sandbox catalog=${result.referenceProducts}, job registrations=${result.referenceJobRegistrations}, native auth/FKs/RLS/helpers/grants verified.`,
  );
} finally {
  await client.end();
}
