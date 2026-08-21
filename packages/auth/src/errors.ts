export const AUTH_ERROR_CODES = [
  'INVALID_AUTH_INPUT',
  'AUTH_APP_NOT_ALLOWED',
  'AUTH_ORGANIZATION_ACCESS_DENIED',
  'AUTH_SIGN_UP_FAILED',
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_SESSION_INVALID',
  'AUTH_SESSION_REFRESH_FAILED',
  'AUTH_SIGN_OUT_FAILED',
  'AUTH_RECOVERY_FAILED',
  'AUTH_RECOVERY_EXCHANGE_FAILED',
  'AUTH_PASSWORD_UPDATE_FAILED',
  'ACCOUNT_NOT_FOUND',
  'ACCOUNT_ACCESS_DENIED',
  'INVALID_ACCOUNT_INPUT',
  'ACCOUNT_OPERATION_FAILED',
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

const SAFE_MESSAGES: Readonly<Record<AuthErrorCode, string>> = Object.freeze({
  INVALID_AUTH_INPUT: 'Authentication input is invalid',
  AUTH_APP_NOT_ALLOWED: 'Authentication is not available for this app',
  AUTH_ORGANIZATION_ACCESS_DENIED: 'Workspace access is not permitted',
  AUTH_SIGN_UP_FAILED: 'Account could not be created',
  AUTH_INVALID_CREDENTIALS: 'Email or password is invalid',
  AUTH_SESSION_INVALID: 'Authentication session is invalid',
  AUTH_SESSION_REFRESH_FAILED: 'Authentication session could not be refreshed',
  AUTH_SIGN_OUT_FAILED: 'Authentication session could not be ended',
  AUTH_RECOVERY_FAILED: 'Password recovery could not be requested',
  AUTH_RECOVERY_EXCHANGE_FAILED: 'Password recovery link is invalid or expired',
  AUTH_PASSWORD_UPDATE_FAILED: 'Password could not be updated',
  ACCOUNT_NOT_FOUND: 'Account profile was not found',
  ACCOUNT_ACCESS_DENIED: 'Account operation is not permitted',
  INVALID_ACCOUNT_INPUT: 'Account profile input is invalid',
  ACCOUNT_OPERATION_FAILED: 'Account operation could not be completed',
});

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = 'AuthError';
    this.code = code;
  }
}
