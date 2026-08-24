export const BILLING_ERROR_CODES = [
  'BILLING_ACCESS_DENIED',
  'INVALID_BILLING_INPUT',
  'PRODUCT_NOT_FOUND',
  'PRICE_NOT_FOUND',
  'PURCHASE_NOT_FOUND',
  'BILLING_IDEMPOTENCY_CONFLICT',
  'INVALID_PAYMENT_TRANSITION',
  'BILLING_PROVIDER_NOT_CONFIGURED',
  'BILLING_PROVIDER_FAILED',
  'BILLING_WEBHOOK_PROVIDER_UNSUPPORTED',
  'BILLING_WEBHOOK_SIGNATURE_INVALID',
  'INVALID_BILLING_WEBHOOK_INPUT',
  'BILLING_WEBHOOK_IDEMPOTENCY_CONFLICT',
  'BILLING_WEBHOOK_PROCESSING_FAILED',
  'BILLING_OPERATION_FAILED',
] as const;

export type BillingErrorCode = (typeof BILLING_ERROR_CODES)[number];

const SAFE_MESSAGES: Readonly<Record<BillingErrorCode, string>> = Object.freeze({
  BILLING_ACCESS_DENIED: 'Billing operation is not permitted',
  INVALID_BILLING_INPUT: 'Billing input is invalid',
  PRODUCT_NOT_FOUND: 'Product was not found',
  PRICE_NOT_FOUND: 'Price was not found',
  PURCHASE_NOT_FOUND: 'Purchase was not found',
  BILLING_IDEMPOTENCY_CONFLICT: 'Idempotency key was already used for another purchase request',
  INVALID_PAYMENT_TRANSITION: 'Payment lifecycle transition is not permitted',
  BILLING_PROVIDER_NOT_CONFIGURED: 'Billing provider is not configured',
  BILLING_PROVIDER_FAILED: 'Billing provider operation failed',
  BILLING_WEBHOOK_PROVIDER_UNSUPPORTED: 'Billing webhook provider is not supported',
  BILLING_WEBHOOK_SIGNATURE_INVALID: 'Billing webhook signature is invalid',
  INVALID_BILLING_WEBHOOK_INPUT: 'Billing webhook input is invalid',
  BILLING_WEBHOOK_IDEMPOTENCY_CONFLICT: 'Billing webhook event identity conflicts with a prior delivery',
  BILLING_WEBHOOK_PROCESSING_FAILED: 'Billing webhook could not be processed',
  BILLING_OPERATION_FAILED: 'Billing operation could not be completed',
});

export class BillingError extends Error {
  readonly code: BillingErrorCode;

  constructor(code: BillingErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = 'BillingError';
    this.code = code;
  }
}
