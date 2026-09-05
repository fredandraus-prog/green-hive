import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  LOCAL_SUPABASE_CONFIRMATION,
  LOCAL_SUPABASE_DATABASE_URL,
  LOCAL_SUPABASE_TARGET,
} from './lib/local-supabase-guard.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmEntrypoint =
  process.env.npm_execpath ??
  path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const supabaseEntrypoint = path.join(
  repositoryRoot,
  'node_modules',
  'supabase',
  'dist',
  'supabase.js',
);

function run(executable, argumentsList, options = {}) {
  const result = spawnSync(executable, argumentsList, {
    cwd: repositoryRoot,
    env: options.environment ?? process.env,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(options.failureMessage ?? 'Local Supabase Storage gate command failed');
  }
  return result;
}

if (!existsSync(supabaseEntrypoint)) {
  throw new Error('Versioned Supabase CLI is missing. Run npm ci first.');
}

console.log('== Green Hive local private Storage gate ==');
run(process.execPath, [npmEntrypoint, 'run', 'supabase:start', '--silent']);
run(process.execPath, [npmEntrypoint, 'run', 'supabase:status', '--silent']);
const status = JSON.parse(run(
  process.execPath,
  [supabaseEntrypoint, 'status', '--output', 'json'],
  { capture: true, failureMessage: 'Supabase local status could not be read' },
).stdout);
const publishableKey = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
const serviceRoleKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
if (!publishableKey || !serviceRoleKey) {
  throw new Error('Supabase local Storage credentials are unavailable');
}

const environment = {
  ...process.env,
  GREEN_HIVE_TEST_DATABASE_URL: status.DB_URL ?? LOCAL_SUPABASE_DATABASE_URL,
  GREEN_HIVE_TEST_TARGET: LOCAL_SUPABASE_TARGET,
  GREEN_HIVE_TEST_CONFIRM: LOCAL_SUPABASE_CONFIRMATION,
  GREEN_HIVE_SUPABASE_AUTH_URL: 'http://127.0.0.1:54321/auth/v1',
  GREEN_HIVE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  GREEN_HIVE_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
};
run(process.execPath, [npmEntrypoint, 'run', 'files:storage:test:supabase', '--silent'], {
  environment,
  failureMessage: 'GH-0602 local private Storage gate failed',
});
console.log('Green Hive local private Storage gate passed; the disposable object was removed.');
