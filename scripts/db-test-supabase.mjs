import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import {
  assertLocalSupabaseTarget,
  assertNativeSupabaseContract,
  cleanupGreenHiveTestState,
  LOCAL_SUPABASE_CONFIRMATION,
  LOCAL_SUPABASE_DATABASE_URL,
  LOCAL_SUPABASE_TARGET,
} from './lib/local-supabase-guard.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmEntrypoint =
  process.env.npm_execpath ??
  path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const gateEnvironment = {
  ...process.env,
  DATABASE_URL: LOCAL_SUPABASE_DATABASE_URL,
  GREEN_HIVE_TEST_DATABASE_URL: LOCAL_SUPABASE_DATABASE_URL,
  GREEN_HIVE_TEST_TARGET: LOCAL_SUPABASE_TARGET,
  GREEN_HIVE_TEST_CONFIRM: LOCAL_SUPABASE_CONFIRMATION,
};

function run(executable, argumentsList, environment = gateEnvironment) {
  const result = spawnSync(executable, argumentsList, {
    cwd: repositoryRoot,
    env: environment,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${executable} ${argumentsList.join(' ')} failed with exit code ${result.status}`);
  }
}

function runNpm(script, environment) {
  run(process.execPath, [npmEntrypoint, 'run', script], environment);
}

async function withGuardedClient(action) {
  assertLocalSupabaseTarget({
    databaseUrl: gateEnvironment.GREEN_HIVE_TEST_DATABASE_URL,
    target: gateEnvironment.GREEN_HIVE_TEST_TARGET,
    confirmation: gateEnvironment.GREEN_HIVE_TEST_CONFIRM,
  });
  const client = new pg.Client({ connectionString: LOCAL_SUPABASE_DATABASE_URL });
  await client.connect();
  try {
    await assertNativeSupabaseContract(client);
    return await action(client);
  } finally {
    await client.end();
  }
}

console.log('== Green Hive local Supabase gate ==');
runNpm('supabase:start');
runNpm('supabase:status');
runNpm('db:validate');

let primaryError;
try {
  await withGuardedClient((client) => cleanupGreenHiveTestState(client));
  runNpm('db:migrate');
  runNpm('db:migrate');
  runNpm('db:seed');
  runNpm('db:seed');
  runNpm('db:test:external', {
    ...gateEnvironment,
    GREEN_HIVE_TEST_PREPARED: 'LOCAL_SUPABASE_BASELINE_READY',
  });
} catch (error) {
  primaryError = error;
} finally {
  try {
    await withGuardedClient((client) => cleanupGreenHiveTestState(client));
    runNpm('db:migrate');
    runNpm('db:seed');
    run(process.execPath, ['scripts/db-smoke-supabase.mjs']);
  } catch (recoveryError) {
    if (primaryError) {
      primaryError = new AggregateError(
        [primaryError, recoveryError],
        'Supabase parity gate failed and the clean baseline could not be restored',
      );
    } else {
      primaryError = recoveryError;
    }
  }
}

if (primaryError) throw primaryError;
runNpm('projects:test:supabase');
runNpm('billing:test:supabase');
runNpm('billing:webhook:test:supabase');
runNpm('entitlements:test:supabase');
runNpm('usage-cost:test:supabase');
runNpm('cost-guard:test:supabase');
runNpm('jobs:test:supabase');
runNpm('workers:test:supabase');
runNpm('ai:test:supabase');
run(process.execPath, ['scripts/db-smoke-supabase.mjs']);
console.log('Green Hive local Supabase gate passed; clean migrated and seeded baseline retained.');
