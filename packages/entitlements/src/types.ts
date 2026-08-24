import type { TrustedOrganizationContext } from '@green-hive/core';

export const ENTITLEMENT_STATUSES = ['ACTIVE', 'REVOKED'] as const;
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];

export interface ProjectEntitlement {
  readonly id: string;
  readonly organizationId: string;
  readonly appId: string;
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly productId: string;
  readonly purchaseId: string;
  readonly paymentId: string;
  readonly productCode: string;
  readonly priceVersion: number;
  readonly capabilityCode: string;
  readonly sourceType: 'PURCHASE';
  readonly status: EntitlementStatus;
  readonly grantedAt: Date;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface EntitlementRepository {
  can(
    context: TrustedOrganizationContext,
    projectId: string,
    capabilityCode: string,
  ): Promise<boolean>;
  list(
    context: TrustedOrganizationContext,
    projectId: string,
  ): Promise<readonly ProjectEntitlement[]>;
}

export interface EntitlementSqlResult<Row> {
  readonly rows: readonly Row[];
}

export interface EntitlementSqlExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<EntitlementSqlResult<Row>>;
}
