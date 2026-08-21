import { AppRegistry } from '@green-hive/core';
import { AuthError, type AuthErrorCode } from './errors.js';
import { assertIdentityForApp, createTrustedAppContext } from './trusted-context.js';
import type {
  AuthProvider,
  AuthSession,
  PasswordRecoveryChallenge,
  PasswordRecoveryCodeExchangeInput,
  PasswordRecoveryCompletionInput,
  PasswordRecoveryInput,
  RefreshSessionInput,
  SignInInput,
  SignOutInput,
  SignUpInput,
  VerifiedAuthIdentity,
} from './types.js';
import {
  validatePasswordRecoveryInput,
  validatePasswordRecoveryCodeExchangeInput,
  validatePasswordRecoveryCompletionInput,
  validateRefreshSessionInput,
  validateSignInInput,
  validateSignOutInput,
  validateSignUpInput,
} from './validation.js';

export class AuthService {
  readonly #provider: AuthProvider;
  readonly #registry: AppRegistry;
  readonly #allowedRecoveryRedirects: ReadonlySet<string>;

  constructor(
    provider: AuthProvider,
    registry: AppRegistry,
    options: { readonly allowedRecoveryRedirects: readonly string[] },
  ) {
    this.#provider = provider;
    this.#registry = registry;
    this.#allowedRecoveryRedirects = new Set(
      options.allowedRecoveryRedirects.map((redirect) => new URL(redirect).toString()),
    );
  }

  async signUp(input: SignUpInput): Promise<AuthSession> {
    const validated = validateSignUpInput(input);
    this.#assertAppAvailable(validated.appCode);
    const session = await this.#execute('AUTH_SIGN_UP_FAILED', () =>
      this.#provider.createAccount(validated),
    );
    return this.#assertSessionApp(session, validated.appCode);
  }

  async signIn(input: SignInInput): Promise<AuthSession> {
    const validated = validateSignInInput(input);
    this.#assertAppAvailable(validated.appCode);
    const session = await this.#execute('AUTH_INVALID_CREDENTIALS', () =>
      this.#provider.signIn(validated),
    );
    try {
      return this.#assertSessionApp(session, validated.appCode);
    } catch (error) {
      await this.#provider.signOut(session.accessToken, 'local').catch(() => undefined);
      throw error;
    }
  }

  async refreshSession(input: RefreshSessionInput): Promise<AuthSession> {
    const validated = validateRefreshSessionInput(input);
    this.#assertAppAvailable(validated.appCode);
    const session = await this.#execute('AUTH_SESSION_REFRESH_FAILED', () =>
      this.#provider.refreshSession(validated.refreshToken),
    );
    return this.#assertSessionApp(session, validated.appCode);
  }

  async signOut(input: SignOutInput): Promise<void> {
    const validated = validateSignOutInput(input);
    await this.#execute('AUTH_SIGN_OUT_FAILED', () =>
      this.#provider.signOut(validated.accessToken, validated.scope),
    );
  }

  async requestPasswordRecovery(input: PasswordRecoveryInput): Promise<PasswordRecoveryChallenge> {
    const validated = validatePasswordRecoveryInput(input);
    if (!this.#allowedRecoveryRedirects.has(validated.redirectTo)) {
      throw new AuthError('INVALID_AUTH_INPUT');
    }
    return this.#execute('AUTH_RECOVERY_FAILED', () =>
      this.#provider.sendPasswordRecovery(validated.email, validated.redirectTo),
    );
  }

  async exchangePasswordRecoveryCode(
    input: PasswordRecoveryCodeExchangeInput,
  ): Promise<AuthSession> {
    const validated = validatePasswordRecoveryCodeExchangeInput(input);
    this.#assertAppAvailable(validated.appCode);
    const session = await this.#execute('AUTH_RECOVERY_EXCHANGE_FAILED', () =>
      this.#provider.exchangePasswordRecoveryCode(
        validated.code,
        validated.state,
        validated.flowId,
      ),
    );
    return this.#assertSessionApp(session, validated.appCode);
  }

  async completePasswordRecovery(input: PasswordRecoveryCompletionInput): Promise<void> {
    const validated = validatePasswordRecoveryCompletionInput(input);
    await this.#execute('AUTH_PASSWORD_UPDATE_FAILED', () =>
      this.#provider.updatePassword(
        validated.accessToken,
        validated.refreshToken,
        validated.newPassword,
      ),
    );
  }

  async verifyAccessToken(accessToken: string): Promise<VerifiedAuthIdentity> {
    if (typeof accessToken !== 'string' || accessToken.length < 16 || accessToken.length > 16 * 1024) {
      throw new AuthError('AUTH_SESSION_INVALID');
    }
    const identity = await this.#execute('AUTH_SESSION_INVALID', () =>
      this.#provider.verifyAccessToken(accessToken),
    );
    createTrustedAppContext(identity);
    this.#assertAppAvailable(identity.appCode);
    return identity;
  }

  async verifyAccessTokenForApp(
    accessToken: string,
    expectedAppCode: string,
  ): Promise<VerifiedAuthIdentity> {
    this.#assertAppAvailable(expectedAppCode);
    return assertIdentityForApp(await this.verifyAccessToken(accessToken), expectedAppCode);
  }

  #assertAppAvailable(appCode: string): void {
    try {
      const app = this.#registry.get(appCode);
      if (app.status === 'DISABLED') throw new Error('disabled');
    } catch {
      throw new AuthError('AUTH_APP_NOT_ALLOWED');
    }
  }

  #assertSessionApp(session: AuthSession, expectedAppCode: string): AuthSession {
    assertIdentityForApp(session.user, expectedAppCode);
    return session;
  }

  async #execute<Result>(code: AuthErrorCode, operation: () => Promise<Result>): Promise<Result> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError(code);
    }
  }
}
