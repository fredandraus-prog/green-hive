import { GoTrueClient, type Session, type User } from '@supabase/supabase-js';
import { Buffer } from 'node:buffer';
import type {
  AuthProvider,
  AuthSession,
  ValidatedCredentials,
  VerifiedAuthIdentity,
} from './types.js';

export interface SupabaseServerAuthConfiguration {
  readonly authUrl: string;
  readonly publishableKey: string;
  readonly serviceRoleKey: string;
}

const SERVER_AUTH_OPTIONS = Object.freeze({
  autoRefreshToken: false,
  persistSession: false,
  detectSessionInUrl: false,
});

const PKCE_AUTH_OPTIONS = Object.freeze({
  ...SERVER_AUTH_OPTIONS,
  persistSession: true,
  skipAutoInitialize: true,
  flowType: 'pkce' as const,
});
const MAX_RECOVERY_STATE_BYTES = 16 * 1024;

interface RecoveryStorage {
  readonly values: Map<string, string>;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

function recoveryStorage(seed: Readonly<Record<string, string>> = {}): RecoveryStorage {
  const values = new Map(Object.entries(seed));
  return {
    values,
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    async removeItem(key) {
      values.delete(key);
    },
  };
}

function encodeRecoveryState(storage: RecoveryStorage): string {
  const entries = Object.fromEntries(storage.values);
  const serialized = JSON.stringify(entries);
  if (storage.values.size < 1 || Buffer.byteLength(serialized, 'utf8') > MAX_RECOVERY_STATE_BYTES) {
    throw new Error('Supabase Auth did not produce a bounded recovery state');
  }
  return Buffer.from(serialized, 'utf8').toString('base64url');
}

function decodeRecoveryState(state: string): Readonly<Record<string, string>> {
  if (
    typeof state !== 'string' ||
    state.length < 16 ||
    state.length > MAX_RECOVERY_STATE_BYTES ||
    !/^[A-Za-z0-9_-]+$/.test(state)
  ) {
    throw new Error('Invalid recovery state');
  }
  const decoded = Buffer.from(state, 'base64url').toString('utf8');
  if (Buffer.byteLength(decoded, 'utf8') > MAX_RECOVERY_STATE_BYTES) {
    throw new Error('Recovery state is too large');
  }
  const parsed: unknown = JSON.parse(decoded);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length < 1 ||
    Object.keys(parsed).length > 12
  ) {
    throw new Error('Recovery state is malformed');
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (
      !/^[A-Za-z0-9._-]{1,240}$/.test(key) ||
      typeof value !== 'string' ||
      value.length < 1 ||
      value.length > 4096
    ) {
      throw new Error('Recovery state contains an invalid entry');
    }
  }
  return parsed as Readonly<Record<string, string>>;
}

function requiredString(value: string, name: string): string {
  if (typeof value !== 'string' || value.trim().length < 1) {
    throw new Error(`Missing ${name}`);
  }
  return value.trim();
}

function requiredApiKey(value: string, name: string): string {
  const apiKey = requiredString(value, name);
  if (!/^[\x21-\x7e]+$/.test(apiKey) || (!apiKey.startsWith('eyJ') && !apiKey.startsWith('sb_'))) {
    throw new Error(`Invalid ${name}`);
  }
  return apiKey;
}

function apiKeyHeaders(apiKey: string): Readonly<Record<string, string>> {
  return apiKey.startsWith('eyJ')
    ? { apikey: apiKey, Authorization: `Bearer ${apiKey}` }
    : { apikey: apiKey };
}

function mapUser(user: User): VerifiedAuthIdentity {
  const appCode = user.app_metadata?.app_code;
  const role = user.app_metadata?.platform_role;
  if (typeof user.email !== 'string' || typeof appCode !== 'string') {
    throw new Error('Supabase Auth user is missing trusted claims');
  }
  if (role !== undefined && role !== 'PLATFORM_ADMIN') {
    throw new Error('Supabase Auth user contains an unsupported platform role');
  }
  return role === undefined
    ? { id: user.id, email: user.email, appCode }
    : { id: user.id, email: user.email, appCode, platformRole: role };
}

function mapSession(session: Session | null): AuthSession {
  if (!session || !session.refresh_token || !session.expires_at) {
    throw new Error('Supabase Auth returned an incomplete session');
  }
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: new Date(session.expires_at * 1000),
    user: mapUser(session.user),
  };
}

export class SupabaseServerAuthProvider implements AuthProvider {
  readonly #authUrl: string;
  readonly #publishableKey: string;
  readonly #adminClient: GoTrueClient;

  constructor(configuration: SupabaseServerAuthConfiguration) {
    const authUrl = requiredString(configuration.authUrl, 'Supabase Auth URL');
    const publishableKey = requiredApiKey(
      configuration.publishableKey,
      'Supabase publishable key',
    );
    const serviceRoleKey = requiredApiKey(
      configuration.serviceRoleKey,
      'Supabase service role key',
    );
    this.#authUrl = authUrl;
    this.#publishableKey = publishableKey;
    this.#adminClient = new GoTrueClient({
      url: authUrl,
      headers: apiKeyHeaders(serviceRoleKey),
      ...SERVER_AUTH_OPTIONS,
    });
  }

  async createAccount(input: ValidatedCredentials): Promise<AuthSession> {
    const created = await this.#adminClient.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      app_metadata: { app_code: input.appCode },
    });
    if (created.error || !created.data.user) throw created.error ?? new Error('User was not created');

    const signedIn = await this.#publicClient().signInWithPassword({
      email: input.email,
      password: input.password,
    });
    if (signedIn.error || !signedIn.data.session) {
      await this.#adminClient.admin.deleteUser(created.data.user.id).catch(() => undefined);
      throw signedIn.error ?? new Error('New user could not sign in');
    }
    return mapSession(signedIn.data.session);
  }

  async signIn(input: ValidatedCredentials): Promise<AuthSession> {
    const result = await this.#publicClient().signInWithPassword({
      email: input.email,
      password: input.password,
    });
    if (result.error) throw result.error;
    return mapSession(result.data.session);
  }

  async refreshSession(refreshToken: string): Promise<AuthSession> {
    const result = await this.#publicClient().refreshSession({ refresh_token: refreshToken });
    if (result.error) throw result.error;
    return mapSession(result.data.session);
  }

  async signOut(accessToken: string, scope: 'local' | 'global'): Promise<void> {
    const result = await this.#adminClient.admin.signOut(accessToken, scope);
    if (result.error) throw result.error;
  }

  async sendPasswordRecovery(email: string, redirectTo: string): Promise<{ state: string }> {
    const storage = recoveryStorage();
    const result = await this.#pkceClient(storage).resetPasswordForEmail(email, {
      redirectTo,
    });
    if (result.error) throw result.error;
    return { state: encodeRecoveryState(storage) };
  }

  async exchangePasswordRecoveryCode(
    code: string,
    state: string,
    flowId?: string,
  ): Promise<AuthSession> {
    const storage = recoveryStorage(decodeRecoveryState(state));
    const result = await this.#pkceClient(storage).exchangeCodeForSession(
      code,
      flowId === undefined ? undefined : { flowId },
    );
    if (result.error) throw result.error;
    return mapSession(result.data.session);
  }

  async updatePassword(
    accessToken: string,
    refreshToken: string,
    newPassword: string,
  ): Promise<void> {
    const client = this.#publicClient();
    const session = await client.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (session.error) throw session.error;
    const result = await client.updateUser({ password: newPassword });
    if (result.error) throw result.error;
  }

  async verifyAccessToken(accessToken: string): Promise<VerifiedAuthIdentity> {
    const result = await this.#publicClient().getUser(accessToken);
    if (result.error || !result.data.user) throw result.error ?? new Error('User was not returned');
    return mapUser(result.data.user);
  }

  #publicClient(): GoTrueClient {
    return new GoTrueClient({
      url: this.#authUrl,
      headers: apiKeyHeaders(this.#publishableKey),
      ...SERVER_AUTH_OPTIONS,
    });
  }

  #pkceClient(storage: RecoveryStorage): GoTrueClient {
    return new GoTrueClient({
      url: this.#authUrl,
      headers: apiKeyHeaders(this.#publishableKey),
      storage,
      ...PKCE_AUTH_OPTIONS,
    });
  }
}
