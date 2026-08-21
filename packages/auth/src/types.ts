import type {
  PlatformRole,
  TrustedAppContext,
  TrustedOrganizationContext,
} from '@green-hive/core';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly appCode: string;
  readonly platformRole?: PlatformRole;
}

export interface AuthSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: Date;
  readonly user: AuthUser;
}

export interface SignUpInput {
  readonly email: string;
  readonly password: string;
  readonly appCode: string;
}

export interface SignInInput {
  readonly email: string;
  readonly password: string;
  readonly appCode: string;
}

export interface RefreshSessionInput {
  readonly refreshToken: string;
  readonly appCode: string;
}

export interface SignOutInput {
  readonly accessToken: string;
  readonly scope?: 'local' | 'global';
}

export interface PasswordRecoveryInput {
  readonly email: string;
  readonly redirectTo: string;
}

export interface PasswordRecoveryChallenge {
  readonly state: string;
}

export interface PasswordRecoveryCodeExchangeInput {
  readonly code: string;
  readonly state: string;
  readonly flowId?: string;
  readonly appCode: string;
}

export interface PasswordRecoveryCompletionInput {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly newPassword: string;
}

export interface ValidatedCredentials {
  readonly email: string;
  readonly password: string;
  readonly appCode: string;
}

export interface VerifiedAuthIdentity extends AuthUser {}

export interface AuthProvider {
  createAccount(input: ValidatedCredentials): Promise<AuthSession>;
  signIn(input: ValidatedCredentials): Promise<AuthSession>;
  refreshSession(refreshToken: string): Promise<AuthSession>;
  signOut(accessToken: string, scope: 'local' | 'global'): Promise<void>;
  sendPasswordRecovery(email: string, redirectTo: string): Promise<PasswordRecoveryChallenge>;
  exchangePasswordRecoveryCode(
    code: string,
    state: string,
    flowId?: string,
  ): Promise<AuthSession>;
  updatePassword(accessToken: string, refreshToken: string, newPassword: string): Promise<void>;
  verifyAccessToken(accessToken: string): Promise<VerifiedAuthIdentity>;
}

export interface AccountProfile {
  readonly userId: string;
  readonly displayName: string | null;
  readonly preferredLanguage: string;
  readonly preferredLocale: string;
  readonly timezone: string;
  readonly preferences: Readonly<Record<string, JsonValue>>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AccountProfileInput {
  readonly displayName?: string | null;
  readonly preferredLanguage?: string;
  readonly preferredLocale?: string;
  readonly timezone?: string;
  readonly preferences?: Readonly<Record<string, JsonValue>>;
}

export interface ValidatedAccountProfileInput extends AccountProfileInput {}

export interface AccountRepository {
  ensure(
    context: TrustedAppContext,
    input: ValidatedAccountProfileInput,
  ): Promise<AccountProfile>;
  get(context: TrustedAppContext): Promise<AccountProfile | null>;
  update(
    context: TrustedAppContext,
    input: ValidatedAccountProfileInput,
  ): Promise<AccountProfile | null>;
}

export interface AuthSqlResult<Row> {
  readonly rows: readonly Row[];
}

export interface AuthSqlExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<AuthSqlResult<Row>>;
}

export interface AuthSqlConnection extends AuthSqlExecutor {
  release(): void;
}

export interface AuthSqlConnectionPool {
  connect(): Promise<AuthSqlConnection>;
}

export interface AuthenticatedOperationContext {
  readonly identity: VerifiedAuthIdentity;
  readonly trustedContext: TrustedAppContext;
  readonly database: AuthSqlExecutor;
}

export interface AuthenticatedOrganizationOperationContext {
  readonly identity: VerifiedAuthIdentity;
  readonly trustedContext: TrustedOrganizationContext;
  readonly database: AuthSqlExecutor;
}

export type AuthenticatedOperation<Result> = (
  context: AuthenticatedOperationContext,
) => Promise<Result>;

export type AuthenticatedOrganizationOperation<Result> = (
  context: AuthenticatedOrganizationOperationContext,
) => Promise<Result>;
