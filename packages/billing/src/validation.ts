import type { TrustedOrganizationContext } from '@green-hive/core';
import { BillingError } from './errors.js';
import type { ValidatedCreatePurchaseInput } from './types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const PRODUCT_CODE = /^[A-Z][A-Z0-9_]{2,127}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const CONTEXT_KEYS = new Set(['userId', 'appCode', 'organizationId', 'platformRole']);
const CREATE_KEYS = new Set(['projectId', 'productCode', 'priceId', 'idempotencyKey']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateTrustedBillingContext(value: unknown): TrustedOrganizationContext {
  if (!isRecord(value) || Object.keys(value).some((key) => !CONTEXT_KEYS.has(key))) {
    throw new BillingError('BILLING_ACCESS_DENIED');
  }
  if (
    typeof value.userId !== 'string' ||
    !UUID.test(value.userId) ||
    typeof value.appCode !== 'string' ||
    !APP_CODE.test(value.appCode) ||
    typeof value.organizationId !== 'string' ||
    !UUID.test(value.organizationId) ||
    (value.platformRole !== undefined && value.platformRole !== 'PLATFORM_ADMIN')
  ) {
    throw new BillingError('BILLING_ACCESS_DENIED');
  }
  return {
    userId: value.userId.toLowerCase(),
    appCode: value.appCode,
    organizationId: value.organizationId.toLowerCase(),
    ...(value.platformRole === undefined ? {} : { platformRole: value.platformRole }),
  };
}

export function validateProductCode(value: unknown): string {
  if (typeof value !== 'string' || !PRODUCT_CODE.test(value)) {
    throw new BillingError('INVALID_BILLING_INPUT');
  }
  return value;
}

export function validateBillingId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new BillingError('INVALID_BILLING_INPUT');
  }
  return value.toLowerCase();
}

export function validateCreatePurchaseInput(value: unknown): ValidatedCreatePurchaseInput {
  if (!isRecord(value) || Object.keys(value).some((key) => !CREATE_KEYS.has(key))) {
    throw new BillingError('INVALID_BILLING_INPUT');
  }
  const projectId = validateBillingId(value.projectId);
  const priceId = validateBillingId(value.priceId);
  const productCode = validateProductCode(value.productCode);
  if (typeof value.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(value.idempotencyKey)) {
    throw new BillingError('INVALID_BILLING_INPUT');
  }
  return {
    projectId,
    productCode,
    priceId,
    idempotencyKey: value.idempotencyKey,
  };
}
