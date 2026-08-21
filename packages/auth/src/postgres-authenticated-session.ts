import type { TrustedAppContext, TrustedOrganizationContext } from '@green-hive/core';
import { AuthError } from './errors.js';
import { createTrustedAppContext } from './trusted-context.js';
import type {
  AuthenticatedOperation,
  AuthenticatedOperationContext,
  AuthenticatedOrganizationOperation,
  AuthSqlConnection,
  AuthSqlConnectionPool,
  VerifiedAuthIdentity,
} from './types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface OrganizationAuthorityRow extends Record<string, unknown> {
  readonly organization_id: string | null;
}

export class PostgresAuthenticatedSessionRunner {
  readonly #pool: AuthSqlConnectionPool;

  constructor(pool: AuthSqlConnectionPool) {
    this.#pool = pool;
  }

  async run<Result>(
    identity: VerifiedAuthIdentity,
    operation: AuthenticatedOperation<Result>,
  ): Promise<Result> {
    const trustedContext = createTrustedAppContext(identity);
    return this.#execute(identity, trustedContext, undefined, operation);
  }

  async runInOrganization<Result>(
    identity: VerifiedAuthIdentity,
    organizationId: string,
    operation: AuthenticatedOrganizationOperation<Result>,
  ): Promise<Result> {
    if (!UUID.test(organizationId)) throw new AuthError('AUTH_ORGANIZATION_ACCESS_DENIED');
    const baseContext = createTrustedAppContext(identity);
    const normalizedOrganizationId = organizationId.toLowerCase();
    const trustedContext: TrustedOrganizationContext = {
      ...baseContext,
      organizationId: normalizedOrganizationId,
    };
    return this.#execute(identity, trustedContext, normalizedOrganizationId, operation);
  }

  async #execute<Result>(
    identity: VerifiedAuthIdentity,
    trustedContext: TrustedAppContext,
    organizationId: string | undefined,
    operation: AuthenticatedOperation<Result> | AuthenticatedOrganizationOperation<Result>,
  ): Promise<Result> {
    const claims = {
      sub: trustedContext.userId,
      role: 'authenticated',
      app_metadata:
        trustedContext.platformRole === undefined
          ? { app_code: trustedContext.appCode }
          : {
              app_code: trustedContext.appCode,
              platform_role: trustedContext.platformRole,
            },
    };
    const connection = await this.#pool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query(
        `WITH request_context AS (
           SELECT gen_random_uuid()::text AS request_id
         )
         SELECT
           set_config('request.jwt.claims', $1, true),
           set_config('request.jwt.claim.sub', $2, true),
           set_config('request.green_hive.organization_id', $3, true),
           set_config('request.green_hive.request_id', request_id, true),
           set_config('request.green_hive.correlation_id', request_id, true)
         FROM request_context`,
        [JSON.stringify(claims), trustedContext.userId, organizationId ?? ''],
      );
      await connection.query('SET LOCAL ROLE authenticated');
      if (organizationId !== undefined) {
        await this.#assertOrganizationAuthority(connection, organizationId);
      }
      const operationContext: AuthenticatedOperationContext = {
        identity,
        trustedContext,
        database: connection,
      };
      const result = await operation(operationContext as never);
      await connection.query('COMMIT');
      return result;
    } catch (error) {
      await connection.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  async #assertOrganizationAuthority(
    connection: AuthSqlConnection,
    organizationId: string,
  ): Promise<void> {
    const result = await connection.query<OrganizationAuthorityRow>(
      'SELECT hive.current_organization_id()::text AS organization_id',
    );
    if (result.rows[0]?.organization_id !== organizationId) {
      throw new AuthError('AUTH_ORGANIZATION_ACCESS_DENIED');
    }
  }
}
