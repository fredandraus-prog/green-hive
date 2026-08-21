import { AuthError } from './errors.js';
import type {
  AccountProfileInput,
  JsonValue,
  PasswordRecoveryCodeExchangeInput,
  PasswordRecoveryCompletionInput,
  PasswordRecoveryInput,
  RefreshSessionInput,
  SignInInput,
  SignOutInput,
  SignUpInput,
  ValidatedAccountProfileInput,
  ValidatedCredentials,
} from './types.js';

const APP_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LANGUAGE = /^[a-z]{2,3}$/;
const LOCALE = /^[a-z]{2,3}(?:-[A-Z][A-Za-z0-9]{1,7})?$/;
const CREDENTIAL_KEYS = new Set(['email', 'password', 'appCode']);
const REFRESH_KEYS = new Set(['refreshToken', 'appCode']);
const SIGN_OUT_KEYS = new Set(['accessToken', 'scope']);
const RECOVERY_KEYS = new Set(['email', 'redirectTo']);
const RECOVERY_EXCHANGE_KEYS = new Set(['code', 'state', 'flowId', 'appCode']);
const RECOVERY_COMPLETION_KEYS = new Set(['accessToken', 'refreshToken', 'newPassword']);
const PROFILE_KEYS = new Set([
  'displayName',
  'preferredLanguage',
  'preferredLocale',
  'timezone',
  'preferences',
]);
const MAX_PREFERENCES_BYTES = 16 * 1024;
const MAX_PREFERENCES_DEPTH = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function validateEmail(value: unknown): string {
  if (typeof value !== 'string') throw new AuthError('INVALID_AUTH_INPUT');
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !EMAIL.test(email)) {
    throw new AuthError('INVALID_AUTH_INPUT');
  }
  return email;
}

function validateAppCode(value: unknown): string {
  if (typeof value !== 'string' || !APP_CODE.test(value)) {
    throw new AuthError('INVALID_AUTH_INPUT');
  }
  return value;
}

function validatePassword(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 10 ||
    value.length > 128 ||
    !/[a-z]/.test(value) ||
    !/[A-Z]/.test(value) ||
    !/[0-9]/.test(value)
  ) {
    throw new AuthError('INVALID_AUTH_INPUT');
  }
  return value;
}

function validateToken(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 16 * 1024) {
    throw new AuthError('INVALID_AUTH_INPUT');
  }
  return value;
}

function validateRecoveryCode(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 16 ||
    value.length > 512 ||
    !/^[A-Za-z0-9._~-]+$/.test(value)
  ) {
    throw new AuthError('INVALID_AUTH_INPUT');
  }
  return value;
}

function validateRecoveryState(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 16 ||
    value.length > 16 * 1024 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new AuthError('INVALID_AUTH_INPUT');
  }
  return value;
}

function isJsonValue(value: unknown, seen: Set<object>, depth: number): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || depth > MAX_PREFERENCES_DEPTH || seen.has(value)) return false;

  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, seen, depth + 1))
    : (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
      Object.values(value).every((entry) => isJsonValue(entry, seen, depth + 1));
  seen.delete(value);
  return valid;
}

export function validateSignUpInput(value: unknown): ValidatedCredentials {
  return validateCredentials(value);
}

export function validateSignInInput(value: unknown): ValidatedCredentials {
  return validateCredentials(value);
}

function validateCredentials(value: unknown): ValidatedCredentials {
  if (!isRecord(value) || !hasOnlyKeys(value, CREDENTIAL_KEYS)) {
    throw new AuthError('INVALID_AUTH_INPUT');
  }
  return {
    email: validateEmail(value.email),
    password: validatePassword(value.password),
    appCode: validateAppCode(value.appCode),
  };
}

export function validateRefreshSessionInput(value: unknown): RefreshSessionInput {
  if (!isRecord(value) || !hasOnlyKeys(value, REFRESH_KEYS)) {
    throw new AuthError('INVALID_AUTH_INPUT');
  }
  return {
    refreshToken: validateToken(value.refreshToken),
    appCode: validateAppCode(value.appCode),
  };
}

export function validateSignOutInput(value: unknown): Required<SignOutInput> {
  if (!isRecord(value) || !hasOnlyKeys(value, SIGN_OUT_KEYS)) {
    throw new AuthError('INVALID_AUTH_INPUT');
  }
  const scope = value.scope ?? 'local';
  if (scope !== 'local' && scope !== 'global') throw new AuthError('INVALID_AUTH_INPUT');
  return { accessToken: validateToken(value.accessToken), scope };
}

export function validatePasswordRecoveryInput(value: unknown): PasswordRecoveryInput {
  if (!isRecord(value) || !hasOnlyKeys(value, RECOVERY_KEYS)) {
    throw new AuthError('INVALID_AUTH_INPUT');
  }
  if (typeof value.redirectTo !== 'string') throw new AuthError('INVALID_AUTH_INPUT');
  let redirectTo: string;
  try {
    const parsed = new URL(value.redirectTo);
    if (parsed.username || parsed.password || parsed.hash) throw new Error('unsafe redirect');
    redirectTo = parsed.toString();
  } catch {
    throw new AuthError('INVALID_AUTH_INPUT');
  }
  return { email: validateEmail(value.email), redirectTo };
}

export function validatePasswordRecoveryCompletionInput(
  value: unknown,
): PasswordRecoveryCompletionInput {
  if (!isRecord(value) || !hasOnlyKeys(value, RECOVERY_COMPLETION_KEYS)) {
    throw new AuthError('INVALID_AUTH_INPUT');
  }
  return {
    accessToken: validateToken(value.accessToken),
    refreshToken: validateToken(value.refreshToken),
    newPassword: validatePassword(value.newPassword),
  };
}

export function validatePasswordRecoveryCodeExchangeInput(
  value: unknown,
): PasswordRecoveryCodeExchangeInput {
  if (!isRecord(value) || !hasOnlyKeys(value, RECOVERY_EXCHANGE_KEYS)) {
    throw new AuthError('INVALID_AUTH_INPUT');
  }
  if (
    value.flowId !== undefined &&
    (typeof value.flowId !== 'string' || !/^[a-f0-9]{32}$/.test(value.flowId))
  ) {
    throw new AuthError('INVALID_AUTH_INPUT');
  }
  return {
    code: validateRecoveryCode(value.code),
    state: validateRecoveryState(value.state),
    ...(value.flowId === undefined ? {} : { flowId: value.flowId }),
    appCode: validateAppCode(value.appCode),
  };
}

export function validateAccountProfileInput(
  value: unknown,
  options: { readonly allowEmpty: boolean },
): ValidatedAccountProfileInput {
  if (!isRecord(value) || !hasOnlyKeys(value, PROFILE_KEYS)) {
    throw new AuthError('INVALID_ACCOUNT_INPUT');
  }
  if (!options.allowEmpty && Object.keys(value).length === 0) {
    throw new AuthError('INVALID_ACCOUNT_INPUT');
  }

  const result: {
    displayName?: string | null;
    preferredLanguage?: string;
    preferredLocale?: string;
    timezone?: string;
    preferences?: Readonly<Record<string, JsonValue>>;
  } = {};

  if (Object.hasOwn(value, 'displayName')) {
    if (value.displayName === null) {
      result.displayName = null;
    } else if (typeof value.displayName === 'string') {
      const displayName = value.displayName.trim();
      if (displayName.length < 1 || displayName.length > 120) {
        throw new AuthError('INVALID_ACCOUNT_INPUT');
      }
      result.displayName = displayName;
    } else {
      throw new AuthError('INVALID_ACCOUNT_INPUT');
    }
  }

  if (Object.hasOwn(value, 'preferredLanguage')) {
    if (typeof value.preferredLanguage !== 'string' || !LANGUAGE.test(value.preferredLanguage)) {
      throw new AuthError('INVALID_ACCOUNT_INPUT');
    }
    result.preferredLanguage = value.preferredLanguage;
  }

  if (Object.hasOwn(value, 'preferredLocale')) {
    if (typeof value.preferredLocale !== 'string' || !LOCALE.test(value.preferredLocale)) {
      throw new AuthError('INVALID_ACCOUNT_INPUT');
    }
    result.preferredLocale = value.preferredLocale;
  }

  if (Object.hasOwn(value, 'timezone')) {
    if (typeof value.timezone !== 'string') throw new AuthError('INVALID_ACCOUNT_INPUT');
    const timezone = value.timezone.trim();
    if (timezone.length < 1 || timezone.length > 64) {
      throw new AuthError('INVALID_ACCOUNT_INPUT');
    }
    result.timezone = timezone;
  }

  if (Object.hasOwn(value, 'preferences')) {
    if (!isRecord(value.preferences) || !isJsonValue(value.preferences, new Set(), 0)) {
      throw new AuthError('INVALID_ACCOUNT_INPUT');
    }
    const serialized = JSON.stringify(value.preferences);
    if (new TextEncoder().encode(serialized).byteLength > MAX_PREFERENCES_BYTES) {
      throw new AuthError('INVALID_ACCOUNT_INPUT');
    }
    result.preferences = JSON.parse(serialized) as Readonly<Record<string, JsonValue>>;
  }

  return result;
}

export type { AccountProfileInput, SignInInput, SignUpInput };
