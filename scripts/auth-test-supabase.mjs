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
const dockerPath = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'Programs', 'DockerDesktop', 'resources', 'bin')
  : undefined;
const runtimeEnvironment = { ...process.env };
if (dockerPath && existsSync(path.join(dockerPath, 'docker.exe'))) {
  const pathKey = Object.keys(runtimeEnvironment).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  runtimeEnvironment[pathKey] = `${dockerPath}${path.delimiter}${runtimeEnvironment[pathKey] ?? ''}`;
}

function run(executable, argumentsList, options = {}) {
  const result = spawnSync(executable, argumentsList, {
    cwd: repositoryRoot,
    env: options.environment ?? runtimeEnvironment,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(options.failureMessage ?? 'Local Auth gate command failed');
  }
  return result;
}

function runNpm(script, environment) {
  return run(process.execPath, [npmEntrypoint, 'run', script, '--silent'], {
    environment,
    failureMessage: `npm run ${script} failed`,
  });
}

if (!existsSync(supabaseEntrypoint)) {
  throw new Error('Versioned Supabase CLI is missing. Run npm ci first.');
}

console.log('== Green Hive local Supabase Auth gate ==');
runNpm('supabase:start');
runNpm('supabase:status');

const statusResult = run(process.execPath, [supabaseEntrypoint, 'status', '--output', 'json'], {
  capture: true,
  failureMessage: 'Supabase local status could not be read',
});
const status = JSON.parse(statusResult.stdout);
const publishableKey = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
const serviceRoleKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
if (!publishableKey || !serviceRoleKey) {
  throw new Error('Supabase local Auth keys are unavailable');
}

const gateEnvironment = {
  ...runtimeEnvironment,
  GREEN_HIVE_TEST_DATABASE_URL: status.DB_URL ?? LOCAL_SUPABASE_DATABASE_URL,
  GREEN_HIVE_TEST_TARGET: LOCAL_SUPABASE_TARGET,
  GREEN_HIVE_TEST_CONFIRM: LOCAL_SUPABASE_CONFIRMATION,
  GREEN_HIVE_SUPABASE_AUTH_URL: 'http://127.0.0.1:54321',
  GREEN_HIVE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  GREEN_HIVE_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  GREEN_HIVE_MAILPIT_URL: 'http://127.0.0.1:54324',
  GREEN_HIVE_AUTH_RECOVERY_REDIRECT: 'http://127.0.0.1:3000/auth/recovery',
};

runNpm('build', gateEnvironment);
let testError;
try {
  run(process.execPath, ['--test', '--test-reporter=spec', 'database/tests/auth-account.integration.test.mjs'], {
    environment: gateEnvironment,
    failureMessage: 'GH-0201 local Auth integration suite failed',
  });
} catch (error) {
  testError = error;
} finally {
  const cleared = await fetch('http://127.0.0.1:54324/api/v1/messages', { method: 'DELETE' });
  if (!cleared.ok && !testError) testError = new Error('Local Mailpit messages could not be cleared');
}
if (testError) throw testError;
console.log('Green Hive local Supabase Auth gate passed; test users and projects were removed.');
