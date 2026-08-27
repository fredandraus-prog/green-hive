import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createRealAIStagingAttemptMarker,
  REAL_AI_STAGING_ATTEMPT_FILE,
  REAL_AI_STAGING_CONFIRMATION,
  REAL_AI_STAGING_OPERATION_ID,
  realAIStagingConfigurationFromEnvironment,
} from '../../scripts/lib/real-ai-staging-guard.mjs';
import {
  SUPABASE_STAGING_CONFIRMATION,
  SUPABASE_STAGING_TARGET,
} from '../../scripts/lib/staging-guard.mjs';

const projectRef = 'abcdefghijklmnopqrst';
const secret = 'test-only-provider-credential-never-logged-1234567890';
const attemptPath = path.join(path.parse(process.cwd()).root, '.secrets', REAL_AI_STAGING_ATTEMPT_FILE);
const valid = Object.freeze({
  GREEN_HIVE_STAGING_PROJECT_REF: projectRef,
  GREEN_HIVE_STAGING_PROJECT_NAME: 'green-hive-staging',
  GREEN_HIVE_STAGING_REGION: 'sa-east-1',
  GREEN_HIVE_STAGING_TARGET: SUPABASE_STAGING_TARGET,
  GREEN_HIVE_STAGING_CONFIRM: SUPABASE_STAGING_CONFIRMATION,
  GREEN_HIVE_STAGING_DATABASE_URL:
    `postgresql://postgres.${projectRef}:secret@aws-0-sa-east-1.pooler.supabase.com:5432/` +
    'postgres?sslmode=verify-full',
  GREEN_HIVE_STAGING_AI_CONFIRM: REAL_AI_STAGING_CONFIRMATION,
  GREEN_HIVE_OPENAI_API_KEY: secret,
  GREEN_HIVE_STAGING_AI_ATTEMPT_PATH: attemptPath,
});

test('real AI staging guard accepts only the dedicated staging target and exact confirmation', () => {
  const configuration = realAIStagingConfigurationFromEnvironment(valid);
  assert.equal(configuration.projectRef, projectRef);
  assert.equal(configuration.apiKey, secret);
  assert.equal(configuration.attemptPath, attemptPath);
  assert.equal(REAL_AI_STAGING_OPERATION_ID, 'gh0504-openai-staging-v0.21.0-0001');
});

test('real AI attempt marker is atomic, minimal and never silently replaced', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'green-hive-ai-attempt-'));
  const secretsDirectory = path.join(temporaryRoot, '.secrets');
  const markerPath = path.join(secretsDirectory, REAL_AI_STAGING_ATTEMPT_FILE);
  try {
    await mkdir(secretsDirectory);
    await createRealAIStagingAttemptMarker(markerPath);
    const marker = JSON.parse(await readFile(markerPath, 'utf8'));
    assert.deepEqual(Object.keys(marker).sort(), ['createdAt', 'operationId', 'purpose']);
    assert.equal(marker.operationId, REAL_AI_STAGING_OPERATION_ID);
    assert.equal(JSON.stringify(marker).includes(secret), false);
    await assert.rejects(
      createRealAIStagingAttemptMarker(markerPath),
      /already recorded/,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('real AI staging guard fails closed without the paid-call confirmation or key', () => {
  assert.throws(
    () => realAIStagingConfigurationFromEnvironment({
      ...valid,
      GREEN_HIVE_STAGING_AI_CONFIRM: undefined,
    }),
    /MAKE_ONE_REAL_PROVIDER_CALL/,
  );
  assert.throws(
    () => realAIStagingConfigurationFromEnvironment({
      ...valid,
      GREEN_HIVE_OPENAI_API_KEY: undefined,
    }),
    /GREEN_HIVE_OPENAI_API_KEY/,
  );
});

test('real AI staging guard rejects malformed keys without leaking them in errors', () => {
  const malformed = 'test-provider-value must-not-appear-in-an-error';
  assert.throws(
    () => realAIStagingConfigurationFromEnvironment({
      ...valid,
      GREEN_HIVE_OPENAI_API_KEY: malformed,
    }),
    (error) => {
      assert.doesNotMatch(error.message, new RegExp(malformed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.match(error.message, /whitespace/);
      return true;
    },
  );
});
