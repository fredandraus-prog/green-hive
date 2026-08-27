export const TRUST_ERROR_CODES = [
  'TRUST_ACCESS_DENIED',
  'TRUST_INVALID_INPUT',
  'TRUST_INVALID_POLICY',
] as const;

export type TrustErrorCode = (typeof TRUST_ERROR_CODES)[number];

const SAFE_MESSAGES: Readonly<Record<TrustErrorCode, string>> = Object.freeze({
  TRUST_ACCESS_DENIED: 'Trust Policy evaluation is not permitted',
  TRUST_INVALID_INPUT: 'Trust Policy input is invalid',
  TRUST_INVALID_POLICY: 'Trust Policy configuration is invalid',
});

export class TrustError extends Error {
  readonly code: TrustErrorCode;

  constructor(code: TrustErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = 'TrustError';
    this.code = code;
  }
}
