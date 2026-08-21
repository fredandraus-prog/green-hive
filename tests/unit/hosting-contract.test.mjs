import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Render Blueprint is a guarded web service without automatic database mutation', async () => {
  const blueprint = await readFile(new URL('../../render.yaml', import.meta.url), 'utf8');
  assert.match(blueprint, /type: web/);
  assert.match(blueprint, /runtime: node/);
  assert.match(blueprint, /region: virginia/);
  assert.match(blueprint, /autoDeployTrigger: checksPass/);
  assert.match(blueprint, /buildCommand: npm ci && npm run build/);
  assert.match(blueprint, /startCommand: npm run start:hosted/);
  assert.match(blueprint, /healthCheckPath: \/api\/ready/);
  assert.doesNotMatch(blueprint, /db:migrate|db:seed|preDeployCommand/);

  for (const key of [
    'GREEN_HIVE_APP_ORIGIN',
    'GREEN_HIVE_AUTH_RECOVERY_REDIRECT',
    'DATABASE_URL',
    'GREEN_HIVE_SUPABASE_PUBLISHABLE_KEY',
    'GREEN_HIVE_SUPABASE_SERVICE_ROLE_KEY',
  ]) {
    assert.match(blueprint, new RegExp(`key: ${key}\\n        sync: false`));
  }
});

test('local preview declares development mode and cannot inherit a hosted runtime', async () => {
  const launcher = await readFile(new URL('../../scripts/reference-app-local.mjs', import.meta.url), 'utf8');
  assert.match(launcher, /NODE_ENV: 'development'/);
  assert.match(launcher, /GREEN_HIVE_RUNTIME_MODE: 'LOCAL_PREVIEW'/);
  assert.match(launcher, /GREEN_HIVE_HTTP_LOGS: 'false'/);
  assert.match(launcher, /runNpm\('build', \{ \.\.\.applicationEnvironment, NODE_ENV: 'production' \}\)/);
});
