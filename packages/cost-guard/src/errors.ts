export const USAGE_COST_ERROR_CODES = [
  'USAGE_COST_ACCESS_DENIED',
  'USAGE_COST_INVALID_INPUT',
  'USAGE_COST_IDEMPOTENCY_CONFLICT',
  'USAGE_COST_OPERATION_FAILED',
] as const;

export type UsageCostErrorCode = (typeof USAGE_COST_ERROR_CODES)[number];

const SAFE_MESSAGES: Readonly<Record<UsageCostErrorCode, string>> = Object.freeze({
  USAGE_COST_ACCESS_DENIED: 'Usage and cost operation is not permitted',
  USAGE_COST_INVALID_INPUT: 'Usage and cost input is invalid',
  USAGE_COST_IDEMPOTENCY_CONFLICT: 'Idempotency key conflicts with an earlier usage or cost operation',
  USAGE_COST_OPERATION_FAILED: 'Usage and cost operation could not be completed',
});

export class UsageCostError extends Error {
  readonly code: UsageCostErrorCode;

  constructor(code: UsageCostErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = 'UsageCostError';
    this.code = code;
  }
}

