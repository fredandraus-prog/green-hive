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

export const COST_GUARD_ERROR_CODES = [
  'COST_GUARD_ACCESS_DENIED',
  'COST_GUARD_INVALID_INPUT',
  'COST_GUARD_IDEMPOTENCY_CONFLICT',
  'COST_GUARD_INVALID_TRANSITION',
  'COST_GUARD_OPERATION_FAILED',
] as const;

export type CostGuardErrorCode = (typeof COST_GUARD_ERROR_CODES)[number];

const COST_GUARD_SAFE_MESSAGES: Readonly<Record<CostGuardErrorCode, string>> = Object.freeze({
  COST_GUARD_ACCESS_DENIED: 'Cost Guard operation is not permitted',
  COST_GUARD_INVALID_INPUT: 'Cost Guard input is invalid',
  COST_GUARD_IDEMPOTENCY_CONFLICT: 'Operation identity conflicts with an earlier Cost Guard decision',
  COST_GUARD_INVALID_TRANSITION: 'Cost reservation cannot perform the requested transition',
  COST_GUARD_OPERATION_FAILED: 'Cost Guard operation could not be completed',
});

export class CostGuardError extends Error {
  readonly code: CostGuardErrorCode;

  constructor(code: CostGuardErrorCode) {
    super(COST_GUARD_SAFE_MESSAGES[code]);
    this.name = 'CostGuardError';
    this.code = code;
  }
}
