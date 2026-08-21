import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { LOCAL_SUPABASE_DATABASE_URL } from './lib/local-supabase-guard.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmEntrypoint =
  process.env.npm_execpath ??
  path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const supabaseEntrypoint = path.join(repositoryRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
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
  if (result.status !== 0) throw new Error(options.failureMessage ?? 'Reference App setup failed');
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

console.log('Preparing the Green Hive local preview...');
runNpm('supabase:start');
const statusResult = run(process.execPath, [supabaseEntrypoint, 'status', '--output', 'json'], {
  capture: true,
  failureMessage: 'Supabase local status could not be read',
});
const status = JSON.parse(statusResult.stdout);
const publishableKey = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
const serviceRoleKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
if (!publishableKey || !serviceRoleKey) throw new Error('Supabase local Auth keys are unavailable');

const applicationEnvironment = {
  ...runtimeEnvironment,
  NODE_ENV: 'production',
  GREEN_HIVE_RUNTIME_MODE: 'LOCAL_PREVIEW',
  ALLOW_PRODUCTION_SEED: 'true',
  GREEN_HIVE_APP_ORIGIN: 'http://127.0.0.1:3000',
  DATABASE_URL: status.DB_URL ?? LOCAL_SUPABASE_DATABASE_URL,
  GREEN_HIVE_SUPABASE_AUTH_URL: 'http://127.0.0.1:54321',
  GREEN_HIVE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  GREEN_HIVE_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  GREEN_HIVE_AUTH_RECOVERY_REDIRECT: 'http://127.0.0.1:3000/auth/recovery',
};

runNpm('db:migrate', applicationEnvironment);
runNpm('db:seed', applicationEnvironment);
runNpm('build', applicationEnvironment);

const entrypoint = path.join(repositoryRoot, 'apps', 'hive-reference-app', 'dist', 'http-entry.js');
const child = spawn(process.execPath, [entrypoint], {
  cwd: repositoryRoot,
  env: applicationEnvironment,
  stdio: 'inherit',
});

const forwardSignal = (signal) => {
  if (!child.killed) child.kill(signal);
};
process.once('SIGINT', () => forwardSignal('SIGINT'));
process.once('SIGTERM', () => forwardSignal('SIGTERM'));

await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    if (code === 0 || signal === 'SIGINT' || signal === 'SIGTERM') resolve();
    else reject(new Error(`Reference App exited unexpectedly with code ${String(code)}`));
  });
});
