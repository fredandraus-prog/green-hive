import { open } from 'node:fs/promises';
import path from 'node:path';
import { stagingDatabaseConfigurationFromEnvironment } from './staging-guard.mjs';

export const REAL_AI_STAGING_CONFIRMATION = 'MAKE_ONE_REAL_PROVIDER_CALL';
export const REAL_AI_STAGING_OPERATION_ID = 'gh0504-openai-staging-v0.21.0-0001';
export const REAL_AI_STAGING_ATTEMPT_FILE =
  'green-hive-gh0504-real-provider-attempt-v0.21.0.json';

function requiredSecret(value, name) {
  if (typeof value !== 'string' || value.length < 20 || value.length > 1_024) {
    throw new Error(`${name} is required and must have a plausible secret length`);
  }
  if (value !== value.trim() || /[\x00-\x20\x7f]/u.test(value)) {
    throw new Error(`${name} must not contain whitespace or control characters`);
  }
  return value;
}

/**
 * Manual, fail-closed gate for the only GH-0504 paid provider invocation.
 * The returned key must stay in server-only memory and must never be logged.
 */
export function realAIStagingConfigurationFromEnvironment(environment = process.env) {
  const staging = stagingDatabaseConfigurationFromEnvironment(environment);
  if (environment.GREEN_HIVE_STAGING_AI_CONFIRM !== REAL_AI_STAGING_CONFIRMATION) {
    throw new Error(
      'Real AI staging gate requires GREEN_HIVE_STAGING_AI_CONFIRM=' +
        REAL_AI_STAGING_CONFIRMATION,
    );
  }
  const apiKey = requiredSecret(
    environment.GREEN_HIVE_OPENAI_API_KEY,
    'GREEN_HIVE_OPENAI_API_KEY',
  );
  const attemptPath = environment.GREEN_HIVE_STAGING_AI_ATTEMPT_PATH;
  if (
    typeof attemptPath !== 'string'
    || !path.isAbsolute(attemptPath)
    || path.basename(attemptPath) !== REAL_AI_STAGING_ATTEMPT_FILE
    || path.basename(path.dirname(attemptPath)) !== '.secrets'
  ) {
    throw new Error('Real AI staging gate requires the protected one-shot attempt path');
  }
  return Object.freeze({ ...staging, apiKey, attemptPath });
}

/**
 * Atomically records that the paid-call boundary is about to be crossed. The marker is never
 * removed automatically: success, provider failure or process interruption all require an
 * explicit operator review before another paid attempt can be authorized.
 */
export async function createRealAIStagingAttemptMarker(attemptPath) {
  let handle;
  try {
    handle = await open(attemptPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({
      operationId: REAL_AI_STAGING_OPERATION_ID,
      purpose: 'GH-0504 controlled real provider attempt',
      createdAt: new Date().toISOString(),
    })}\n`, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EEXIST') {
      throw new Error('The one-shot GH-0504 real AI attempt was already recorded');
    }
    throw error;
  } finally {
    await handle?.close();
  }
}
