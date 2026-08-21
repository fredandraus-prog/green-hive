import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  AppRegistry,
  HiveError,
  validateAppManifest,
} from '../packages/core/dist/index.js';
import { referenceAppManifest } from '../apps/hive-reference-app/dist/manifest.js';

test('REFERENCE_APP manifest validates', () => {
  const result = validateAppManifest(referenceAppManifest);
  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('TypeScript and JSON REFERENCE_APP manifests are identical', async () => {
  const jsonManifest = JSON.parse(
    await readFile(new URL('../apps/hive-reference-app/app.manifest.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(jsonManifest, referenceAppManifest);
});

test('invalid manifest is rejected', () => {
  const invalid = {
    ...referenceAppManifest,
    appCode: 'bad app',
    defaultLocale: 'es-ES',
  };
  const result = validateAppManifest(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('appCode')));
  assert.ok(result.errors.some((error) => error.includes('defaultLocale')));
});

test('application-owned codes must be namespaced', () => {
  const invalid = {
    ...referenceAppManifest,
    jobTypes: ['OTHER_JOB'],
  };
  const result = validateAppManifest(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('namespaced')));
});

test('registry rejects duplicate app registration', () => {
  const registry = new AppRegistry();
  registry.register(referenceAppManifest);
  assert.throws(
    () => registry.register(referenceAppManifest),
    (error) => error instanceof HiveError && error.code === 'APP_ALREADY_REGISTERED',
  );
});
