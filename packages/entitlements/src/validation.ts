import type { TrustedOrganizationContext } from '@green-hive/core';
import { EntitlementError } from './errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const CAPABILITY_CODE = /^[A-Z][A-Z0-9_]{2,127}$/;
const CONTEXT_KEYS = new Set(['userId', 'appCode', 'organizationId', 'platformRole']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateTrustedEntitlementContext(
  value: unknown,
): TrustedOrganizationContext {
  if (!isRecord(value) || Object.keys(value).some((key) => !CONTEXT_KEYS.has(key))) {
    throw new EntitlementError('ENTITLEMENT_ACCESS_DENIED');
  }
  if (
    typeof value.userId !== 'string'
    || !UUID.test(value.userId)
    || typeof value.appCode !== 'string'
    || !APP_CODE.test(value.appCode)
    || typeof value.organizationId !== 'string'
    || !UUID.test(value.organizationId)
    || (value.platformRole !== undefined && value.platformRole !== 'PLATFORM_ADMIN')
  ) {
    throw new EntitlementError('ENTITLEMENT_ACCESS_DENIED');
  }
  return {
    userId: value.userId.toLowerCase(),
    appCode: value.appCode,
    organizationId: value.organizationId.toLowerCase(),
    ...(value.platformRole === undefined ? {} : { platformRole: value.platformRole }),
  };
}

export function validateEntitlementProjectId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new EntitlementError('INVALID_ENTITLEMENT_INPUT');
  }
  return value.toLowerCase();
}

export function validateCapabilityCode(value: unknown): string {
  if (typeof value !== 'string' || !CAPABILITY_CODE.test(value)) {
    throw new EntitlementError('INVALID_ENTITLEMENT_INPUT');
  }
  return value;
}
