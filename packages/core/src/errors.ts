export const HIVE_ERROR_CODES = [
  'VALIDATION_FAILED',
  'APP_ALREADY_REGISTERED',
  'APP_NOT_FOUND',
  'FORBIDDEN',
  'ENTITLEMENT_REQUIRED',
  'BUDGET_EXHAUSTED',
  'PROVIDER_UNAVAILABLE',
  'JOB_FAILED',
] as const;

export type HiveErrorCode = (typeof HIVE_ERROR_CODES)[number];

export class HiveError extends Error {
  readonly code: HiveErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(code: HiveErrorCode, message: string, details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.name = 'HiveError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
