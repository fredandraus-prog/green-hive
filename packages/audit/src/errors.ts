export const AUDIT_ERROR_CODES = [
  'AUDIT_ACCESS_DENIED',
  'AUDIT_INVALID_INPUT',
  'AUDIT_OPERATION_FAILED',
] as const;

export type AuditErrorCode = (typeof AUDIT_ERROR_CODES)[number];

export class AuditError extends Error {
  readonly code: AuditErrorCode;

  constructor(code: AuditErrorCode) {
    super(code);
    this.name = 'AuditError';
    this.code = code;
  }
}
