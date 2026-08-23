export const BILLING_ERROR_CODES = [
  'BILLING_ACCESS_DENIED',
  'INVALID_BILLING_INPUT',
  'PRODUCT_NOT_FOUND',
  'PRICE_NOT_FOUND',
  'PURCHASE_NOT_FOUND',
  'BILLING_IDEMPOTENCY_CONFLICT',
  'INVALID_PAYMENT_TRANSITION',
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
