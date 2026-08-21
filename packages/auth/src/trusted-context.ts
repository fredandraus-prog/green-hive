import type { TrustedAppContext } from '@green-hive/core';
import { AuthError } from './errors.js';
import type { VerifiedAuthIdentity } from './types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const IDENTITY_KEYS = new Set(['id', 'email', 'appCode', 'platformRole']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createTrustedAppContext(value: unknown): TrustedAppContext {
  if (!isRecord(value) || Object.keys(value).some((key) => !IDENTITY_KEYS.has(key))) {
    throw new AuthError('AUTH_SESSION_INVALID');
  }
  if (typeof value.id !== 'string' || !UUID.test(value.id)) {
    throw new AuthError('AUTH_SESSION_INVALID');
  }
  if (typeof value.email !== 'string' || value.email.length < 3 || value.email.length > 254) {
    throw new AuthError('AUTH_SESSION_INVALID');
  }
  if (typeof value.appCode !== 'string' || !APP_CODE.test(value.appCode)) {
    throw new AuthError('AUTH_SESSION_INVALID');
  }
  if (value.platformRole !== undefined && value.platformRole !== 'PLATFORM_ADMIN') {
    throw new AuthError('AUTH_SESSION_INVALID');
  }
  return value.platformRole === undefined
    ? { userId: value.id.toLowerCase(), appCode: value.appCode }
    : {
        userId: value.id.toLowerCase(),
        appCode: value.appCode,
        platformRole: value.platformRole,
      };
}

export function assertIdentityForApp(
  identity: VerifiedAuthIdentity,
  expectedAppCode: string,
): VerifiedAuthIdentity {
  if (identity.appCode !== expectedAppCode) throw new AuthError('AUTH_APP_NOT_ALLOWED');
  createTrustedAppContext(identity);
  return identity;
}
