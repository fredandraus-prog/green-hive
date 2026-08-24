export const ENTITLEMENT_ERROR_CODES = [
  'ENTITLEMENT_ACCESS_DENIED',
  'INVALID_ENTITLEMENT_INPUT',
  'ENTITLEMENT_OPERATION_FAILED',
] as const;

export type EntitlementErrorCode = (typeof ENTITLEMENT_ERROR_CODES)[number];

const SAFE_MESSAGES: Readonly<Record<EntitlementErrorCode, string>> = Object.freeze({
  ENTITLEMENT_ACCESS_DENIED: 'Entitlement operation is not permitted',
  INVALID_ENTITLEMENT_INPUT: 'Entitlement input is invalid',
  ENTITLEMENT_OPERATION_FAILED: 'Entitlement operation could not be completed',
});

export class EntitlementError extends Error {
  readonly code: EntitlementErrorCode;

  constructor(code: EntitlementErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = 'EntitlementError';
    this.code = code;
  }
}
