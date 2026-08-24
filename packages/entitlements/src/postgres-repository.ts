import type { TrustedOrganizationContext } from '@green-hive/core';
import { EntitlementError } from './errors.js';
import type {
  EntitlementRepository,
  EntitlementSqlExecutor,
  EntitlementStatus,
  ProjectEntitlement,
} from './types.js';

interface AuthorityRow extends Record<string, unknown> {
  readonly user_id: string | null;
  readonly app_code: string | null;
  readonly app_id: string | null;
  readonly organization_id: string | null;
  readonly has_trusted_organization_context: boolean;
  readonly is_platform_admin: boolean;
}

interface EntitlementRow extends Record<string, unknown> {
  readonly id: string;
  readonly organization_id: string;
  readonly app_id: string;
  readonly project_id: string;
  readonly owner_user_id: string;
  readonly product_id: string;
  readonly purchase_id: string;
  readonly payment_id: string;
  readonly product_code: string;
  readonly price_version: number;
  readonly capability_code: string;
  readonly source_type: 'PURCHASE';
  readonly status: EntitlementStatus;
  readonly granted_at: Date | string;
  readonly revoked_at: Date | string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

const ENTITLEMENT_COLUMNS = `
  id,
  organization_id,
  app_id,
  project_id,
  owner_user_id,
  product_id,
  purchase_id,
  payment_id,
  product_code,
  price_version,
  capability_code,
  source_type,
  status,
  granted_at,
  revoked_at,
  created_at,
  updated_at`;

function asDate(value: Date | string, field: string): Date {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid ${field}`);
  return parsed;
}

function mapEntitlement(row: EntitlementRow): ProjectEntitlement {
  return {
    id: row.id,
    organizationId: row.organization_id,
    appId: row.app_id,
    projectId: row.project_id,
    ownerUserId: row.owner_user_id,
    productId: row.product_id,
    purchaseId: row.purchase_id,
    paymentId: row.payment_id,
    productCode: row.product_code,
    priceVersion: row.price_version,
    capabilityCode: row.capability_code,
    sourceType: row.source_type,
    status: row.status,
    grantedAt: asDate(row.granted_at, 'granted_at'),
    revokedAt: row.revoked_at === null ? null : asDate(row.revoked_at, 'revoked_at'),
    createdAt: asDate(row.created_at, 'created_at'),
    updatedAt: asDate(row.updated_at, 'updated_at'),
  };
}

export class PostgresEntitlementRepository implements EntitlementRepository {
  readonly #database: EntitlementSqlExecutor;

  constructor(database: EntitlementSqlExecutor) {
    this.#database = database;
  }

  async can(
    context: TrustedOrganizationContext,
    projectId: string,
    capabilityCode: string,
  ): Promise<boolean> {
    await this.#assertAuthority(context);
    const result = await this.#database.query<{ allowed: boolean }>(
      'SELECT hive.can_project_capability($1::uuid, $2::text) AS allowed',
      [projectId, capabilityCode],
    );
    return result.rows[0]?.allowed === true;
  }

  async list(
    context: TrustedOrganizationContext,
    projectId: string,
  ): Promise<readonly ProjectEntitlement[]> {
    const authority = await this.#assertAuthority(context);
    const result = await this.#database.query<EntitlementRow>(
      `SELECT ${ENTITLEMENT_COLUMNS}
       FROM hive.project_entitlements
       WHERE project_id = $1::uuid
         AND owner_user_id = $2::uuid
         AND app_id = $3::uuid
         AND organization_id = $4::uuid
       ORDER BY capability_code, purchase_id`,
      [projectId, context.userId, authority.app_id, authority.organization_id],
    );
    return result.rows.map(mapEntitlement);
  }

  async #assertAuthority(context: TrustedOrganizationContext): Promise<AuthorityRow> {
    const result = await this.#database.query<AuthorityRow>(
      `SELECT
         auth.uid()::text AS user_id,
         hive.current_app_code() AS app_code,
         hive.current_app_id()::text AS app_id,
         hive.current_organization_id()::text AS organization_id,
         hive.has_trusted_organization_context() AS has_trusted_organization_context,
         hive.is_platform_admin() AS is_platform_admin`,
    );
    const authority = result.rows[0];
    if (
      !authority?.app_id
      || !authority.organization_id
      || !authority.has_trusted_organization_context
      || authority.is_platform_admin
      || authority.user_id !== context.userId
      || authority.app_code !== context.appCode
      || authority.organization_id !== context.organizationId
    ) {
      throw new EntitlementError('ENTITLEMENT_ACCESS_DENIED');
    }
    return authority;
  }
}
