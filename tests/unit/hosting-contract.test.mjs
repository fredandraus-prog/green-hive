import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Render Blueprint is a guarded web service without automatic database mutation', async () => {
  const blueprint = await readFile(new URL('../../render.yaml', import.meta.url), 'utf8');
  assert.match(blueprint, /type: web/);
  assert.match(blueprint, /runtime: node/);
  assert.match(blueprint, /plan: free/);
  assert.match(blueprint, /region: virginia/);
  assert.match(blueprint, /autoDeployTrigger: checksPass/);
  assert.match(blueprint, /buildCommand: npm ci --include=dev && npm run build/);
  assert.match(blueprint, /startCommand: npm run start:hosted/);
  assert.match(blueprint, /healthCheckPath: \/api\/ready/);
  assert.match(
    blueprint,
    /key: NODE_EXTRA_CA_CERTS\n        value: \.\/config\/supabase-root-2021-ca\.crt/,
  );
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

test('hosted acceptance is exact-target, loopback-mediated and cleanup guarded', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  );
  const acceptance = await readFile(
    new URL('../../scripts/hosted-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const wrapper = await readFile(
    new URL('../../scripts/staging-database-windows.ps1', import.meta.url),
    'utf8',
  );

  assert.equal(
    packageJson.scripts['hosted:acceptance'],
    'pwsh -NoProfile -File scripts/staging-database-windows.ps1 hosted-acceptance',
  );
  assert.match(acceptance, /https:\/\/green-hive-staging\.onrender\.com/);
  assert.match(acceptance, /CREATE_DISPOSABLE_HOSTED_FIXTURES/);
  assert.match(acceptance, /server\.listen\(0, '127\.0\.0\.1'/);
  assert.match(acceptance, /cleanupGreenHiveUserData/);
  assert.match(acceptance, /admin\.admin\.deleteUser/);
  assert.match(acceptance, /finally \{\n  await cleanupFixtures\(\)/);
  assert.doesNotMatch(acceptance, /console\.log\([^\n]*(recoveryUrl|serviceRoleKey|databaseUrl)/);

  assert.match(wrapper, /rev-parse --path-format=absolute --git-common-dir/);
  assert.match(wrapper, /green-hive-staging-secret-key\.dpapi/);
  assert.match(wrapper, /Remove-Item Env:GREEN_HIVE_HOSTED_TEST_CONFIRM/);
});

test('hosted security smoke is exact-target and exercises bounded Auth abuse without secrets', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  );
  const smoke = await readFile(
    new URL('../../scripts/hosted-security-smoke.mjs', import.meta.url),
    'utf8',
  );
  const bundleSmoke = await readFile(
    new URL('../../scripts/security-smoke.mjs', import.meta.url),
    'utf8',
  );

  assert.equal(packageJson.scripts['hosted:security'], 'node scripts/hosted-security-smoke.mjs');
  assert.match(smoke, /https:\/\/green-hive-staging\.onrender\.com/);
  assert.match(smoke, /EXERCISE_STAGING_RATE_LIMIT/);
  assert.match(smoke, /attempt <= 10/);
  assert.match(smoke, /HOSTED_SECURITY_SMOKE_PASS/);
  assert.doesNotMatch(smoke, /DATABASE_URL|SERVICE_ROLE|serviceRole|admin\.deleteUser/);
  assert.match(bundleSmoke, /SECURITY_BUNDLE_SMOKE_PASS/);
  assert.match(bundleSmoke, /GREEN_HIVE_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(packageJson.scripts.verify, /npm run security:smoke$/);
});
