import type { TrustedOrganizationContext } from '@green-hive/core';
import { BillingError } from './errors.js';
import type {
  ProviderReconciliationResult,
  ProviderPaymentResult,
  ProviderRefundResult,
  ValidatedCreatePurchaseInput,
  VerifiedProviderWebhookEvent,
} from './types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const PRODUCT_CODE = /^[A-Z][A-Z0-9_]{2,127}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const CONTEXT_KEYS = new Set(['userId', 'appCode', 'organizationId', 'platformRole']);
const CREATE_KEYS = new Set(['projectId', 'productCode', 'priceId', 'idempotencyKey']);
const PROVIDER_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const PROVIDER_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;
const FAILURE_CODE = /^[A-Z][A-Z0-9_]{1,127}$/;
const PAYMENT_PAID_KEYS = new Set(['status', 'providerCode', 'providerPaymentId']);
const PAYMENT_FAILED_KEYS = new Set([
  'status',
  'providerCode',
  'providerPaymentId',
  'failureCode',
]);
const REFUND_KEYS = new Set(['status', 'providerCode', 'providerRefundId']);
const VERIFIED_WEBHOOK_KEYS = new Set([
  'providerCode',
  'providerEventId',
  'eventType',
  'purchaseId',
  'providerPaymentId',
  'providerRefundId',
  'failureCode',
]);

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

export function validateProviderCode(value: unknown): string {
  if (typeof value !== 'string' || !PROVIDER_CODE.test(value)) {
    throw new BillingError('BILLING_PROVIDER_FAILED');
  }
  return value;
}

export function validateProviderReference(value: unknown): string {
  if (typeof value !== 'string' || !PROVIDER_REFERENCE.test(value)) {
    throw new BillingError('BILLING_PROVIDER_FAILED');
  }
  return value;
}

export function validateProviderPaymentResult(value: unknown): ProviderPaymentResult {
  if (!isRecord(value) || (value.status !== 'PAID' && value.status !== 'FAILED')) {
    throw new BillingError('BILLING_PROVIDER_FAILED');
  }
  const allowed = value.status === 'PAID' ? PAYMENT_PAID_KEYS : PAYMENT_FAILED_KEYS;
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new BillingError('BILLING_PROVIDER_FAILED');
  }
  const providerCode = validateProviderCode(value.providerCode);
  const providerPaymentId = validateProviderReference(value.providerPaymentId);
  if (value.status === 'PAID') {
    return { status: 'PAID', providerCode, providerPaymentId };
  }
  if (typeof value.failureCode !== 'string' || !FAILURE_CODE.test(value.failureCode)) {
    throw new BillingError('BILLING_PROVIDER_FAILED');
  }
  return {
    status: 'FAILED',
    providerCode,
    providerPaymentId,
    failureCode: value.failureCode,
  };
}

export function validateProviderRefundResult(value: unknown): ProviderRefundResult {
  if (
    !isRecord(value) ||
    value.status !== 'REFUNDED' ||
    Object.keys(value).some((key) => !REFUND_KEYS.has(key))
  ) {
    throw new BillingError('BILLING_PROVIDER_FAILED');
  }
  return {
    status: 'REFUNDED',
    providerCode: validateProviderCode(value.providerCode),
    providerRefundId: validateProviderReference(value.providerRefundId),
  };
}

export function validateProviderReconciliationResult(
  value: unknown,
): ProviderReconciliationResult {
  if (isRecord(value) && value.status === 'REFUNDED') {
    return validateProviderRefundResult(value);
  }
  return validateProviderPaymentResult(value);
}

export function validateVerifiedProviderWebhookEvent(
  value: unknown,
): VerifiedProviderWebhookEvent {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !VERIFIED_WEBHOOK_KEYS.has(key)) ||
    !['PAYMENT_PAID', 'PAYMENT_FAILED', 'PAYMENT_REFUNDED'].includes(
      value.eventType as string,
    )
  ) {
    throw new BillingError('INVALID_BILLING_WEBHOOK_INPUT');
  }

  let purchaseId: string;
  let providerCode: string;
  let providerEventId: string;
  let providerPaymentId: string;
  try {
    purchaseId = validateBillingId(value.purchaseId);
    providerCode = validateProviderCode(value.providerCode);
    providerEventId = validateProviderReference(value.providerEventId);
    providerPaymentId = validateProviderReference(value.providerPaymentId);
  } catch {
    throw new BillingError('INVALID_BILLING_WEBHOOK_INPUT');
  }

  const providerRefundId = value.providerRefundId;
  const failureCode = value.failureCode;
  if (
    (value.eventType === 'PAYMENT_PAID' &&
      (providerRefundId !== null || failureCode !== null)) ||
    (value.eventType === 'PAYMENT_FAILED' &&
      (providerRefundId !== null ||
        typeof failureCode !== 'string' ||
        !FAILURE_CODE.test(failureCode))) ||
    (value.eventType === 'PAYMENT_REFUNDED' &&
      (failureCode !== null || providerRefundId === null))
  ) {
    throw new BillingError('INVALID_BILLING_WEBHOOK_INPUT');
  }

  let normalizedRefundId: string | null = null;
  if (providerRefundId !== null) {
    try {
      normalizedRefundId = validateProviderReference(providerRefundId);
    } catch {
      throw new BillingError('INVALID_BILLING_WEBHOOK_INPUT');
    }
  }

  return {
    providerCode,
    providerEventId,
    eventType: value.eventType as VerifiedProviderWebhookEvent['eventType'],
    purchaseId,
    providerPaymentId,
    providerRefundId: normalizedRefundId,
    failureCode: typeof failureCode === 'string' ? failureCode : null,
  };
}
