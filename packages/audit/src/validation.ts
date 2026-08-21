import type { TrustedOrganizationContext } from '@green-hive/core';
import { AuditError } from './errors.js';
import type { ValidatedListAuditEventsInput } from './types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateAuditContext(context: unknown): TrustedOrganizationContext {
  if (
    !isRecord(context) ||
    Object.keys(context).some(
      (key) => !['userId', 'appCode', 'organizationId', 'platformRole'].includes(key),
    ) ||
    typeof context.userId !== 'string' ||
    !UUID.test(context.userId) ||
    typeof context.appCode !== 'string' ||
    !APP_CODE.test(context.appCode) ||
    typeof context.organizationId !== 'string' ||
    !UUID.test(context.organizationId) ||
    (context.platformRole !== undefined && context.platformRole !== 'PLATFORM_ADMIN')
  ) {
    throw new AuditError('AUDIT_ACCESS_DENIED');
  }
  return context as unknown as TrustedOrganizationContext;
}

export function validateListAuditEventsInput(
  input: unknown = {},
): ValidatedListAuditEventsInput {
  if (!isRecord(input)) throw new AuditError('AUDIT_INVALID_INPUT');
  const limit = input.limit;
  const before = input.before;
  if (
    Object.keys(input).some((key) => !['limit', 'before'].includes(key)) ||
    (limit !== undefined &&
      (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100)) ||
    (before !== undefined &&
      (!(before instanceof Date) || Number.isNaN(before.getTime())))
  ) {
    throw new AuditError('AUDIT_INVALID_INPUT');
  }
  return {
    limit: limit === undefined ? 50 : limit as number,
    before: before === undefined ? null : new Date((before as Date).getTime()),
  };
}
