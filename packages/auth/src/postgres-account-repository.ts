import type { TrustedAppContext } from '@green-hive/core';
import { AuthError } from './errors.js';
import type {
  AccountProfile,
  AccountRepository,
  AuthSqlExecutor,
  JsonValue,
  ValidatedAccountProfileInput,
} from './types.js';

interface AuthorityRow extends Record<string, unknown> {
  readonly user_id: string | null;
  readonly app_code: string | null;
  readonly app_id: string | null;
  readonly is_platform_admin: boolean;
}

interface AccountProfileRow extends Record<string, unknown> {
  readonly user_id: string;
  readonly display_name: string | null;
  readonly preferred_language: string;
  readonly preferred_locale: string;
  readonly timezone: string;
  readonly preferences: Record<string, JsonValue>;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

const PROFILE_COLUMNS = `
  user_id,
  display_name,
  preferred_language,
  preferred_locale,
  timezone,
  preferences,
  created_at,
  updated_at`;

function asDate(value: Date | string, field: string): Date {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid ${field}`);
  return parsed;
}

function mapProfile(row: AccountProfileRow): AccountProfile {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    preferredLanguage: row.preferred_language,
    preferredLocale: row.preferred_locale,
    timezone: row.timezone,
    preferences: row.preferences,
    createdAt: asDate(row.created_at, 'created_at'),
    updatedAt: asDate(row.updated_at, 'updated_at'),
  };
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export class PostgresAccountRepository implements AccountRepository {
  readonly #database: AuthSqlExecutor;

  constructor(database: AuthSqlExecutor) {
    this.#database = database;
  }

  async ensure(
    context: TrustedAppContext,
    input: ValidatedAccountProfileInput,
  ): Promise<AccountProfile> {
    await this.#assertAuthority(context, true);
    await this.#database.query(
      `INSERT INTO hive.user_profiles (
         user_id,
         display_name,
         preferred_language,
         preferred_locale,
         timezone,
         preferences
       )
       VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (user_id) DO NOTHING`,
      [
        context.userId,
        input.displayName ?? null,
        input.preferredLanguage ?? 'pt',
        input.preferredLocale ?? 'pt-BR',
        input.timezone ?? 'UTC',
        JSON.stringify(input.preferences ?? {}),
      ],
    );
    const profile = await this.get(context);
    if (!profile) throw new Error('Profile bootstrap returned no row');
    return profile;
  }

  async get(context: TrustedAppContext): Promise<AccountProfile | null> {
    await this.#assertAuthority(context, false);
    const result = await this.#database.query<AccountProfileRow>(
      `SELECT ${PROFILE_COLUMNS}
       FROM hive.user_profiles
       WHERE user_id = $1::uuid`,
      [context.userId],
    );
    const row = result.rows[0];
    return row ? mapProfile(row) : null;
  }

  async update(
    context: TrustedAppContext,
    input: ValidatedAccountProfileInput,
  ): Promise<AccountProfile | null> {
    await this.#assertAuthority(context, true);
    const result = await this.#database.query<AccountProfileRow>(
      `UPDATE hive.user_profiles
       SET
         display_name = CASE WHEN $2::boolean THEN $3::text ELSE display_name END,
         preferred_language = CASE WHEN $4::boolean THEN $5::text ELSE preferred_language END,
         preferred_locale = CASE WHEN $6::boolean THEN $7::text ELSE preferred_locale END,
         timezone = CASE WHEN $8::boolean THEN $9::text ELSE timezone END,
         preferences = CASE WHEN $10::boolean THEN $11::jsonb ELSE preferences END,
         updated_at = now()
       WHERE user_id = $1::uuid
       RETURNING ${PROFILE_COLUMNS}`,
      [
        context.userId,
        hasOwn(input, 'displayName'),
        input.displayName ?? null,
        hasOwn(input, 'preferredLanguage'),
        input.preferredLanguage ?? null,
        hasOwn(input, 'preferredLocale'),
        input.preferredLocale ?? null,
        hasOwn(input, 'timezone'),
        input.timezone ?? null,
        hasOwn(input, 'preferences'),
        input.preferences === undefined ? null : JSON.stringify(input.preferences),
      ],
    );
    const row = result.rows[0];
    return row ? mapProfile(row) : null;
  }

  async #assertAuthority(context: TrustedAppContext, write: boolean): Promise<AuthorityRow> {
    const result = await this.#database.query<AuthorityRow>(
      `SELECT
         auth.uid()::text AS user_id,
         hive.current_app_code() AS app_code,
         hive.current_app_id()::text AS app_id,
         hive.is_platform_admin() AS is_platform_admin`,
    );
    const authority = result.rows[0];
    if (
      !authority?.app_id ||
      authority.user_id !== context.userId ||
      authority.app_code !== context.appCode ||
      (write && authority.is_platform_admin)
    ) {
      throw new AuthError('ACCOUNT_ACCESS_DENIED');
    }
    return authority;
  }
}
