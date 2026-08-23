import type { TrustedOrganizationContext } from '@green-hive/core';

export const AUDIT_EVENT_CODES = [
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'ORGANIZATION_CREATED',
  'ORGANIZATION_MEMBER_ADDED',
  'ORGANIZATION_MEMBER_CHANGED',
  'ORGANIZATION_APP_INSTALLED',
  'PROJECT_CREATED',
  'PROJECT_ARCHIVED',
  'PROJECT_DELETION_REQUESTED',
  'PURCHASE_CREATED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_FAILED',
  'PAYMENT_REFUNDED',
  'ENTITLEMENT_GRANTED',
  'ENTITLEMENT_CHANGED',
  'JOB_FAILED',
  'FILE_EXPORTED',
  'ADMIN_ACCESS',
  'FEATURE_FLAG_CHANGED',
  'PROVIDER_STATUS_CHANGED',
] as const;

export type AuditEventCode = (typeof AUDIT_EVENT_CODES)[number];

export const AUDIT_ACTOR_TYPES = ['USER', 'PLATFORM_ADMIN', 'SYSTEM'] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export const AUDIT_SUBJECT_TYPES = [
  'AUTHENTICATION',
  'ORGANIZATION',
  'ORGANIZATION_MEMBER',
  'ORGANIZATION_APP',
  'PROJECT',
  'PURCHASE',
  'PAYMENT',
  'PLATFORM',
] as const;
export type AuditSubjectType = (typeof AUDIT_SUBJECT_TYPES)[number];

export const AUDIT_OUTCOMES = ['SUCCEEDED', 'DENIED', 'FAILED'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export type AuditMetadataValue = boolean | number | string | null;
export type AuditMetadata = Readonly<Record<string, AuditMetadataValue>>;

export interface AuditEvent {
  readonly id: string;
  readonly eventCode: AuditEventCode;
  readonly actorUserId: string | null;
  readonly actorType: AuditActorType;
  readonly organizationId: string | null;
  readonly appId: string | null;
  readonly projectId: string | null;
  readonly subjectType: AuditSubjectType;
  readonly subjectId: string | null;
  readonly outcome: AuditOutcome;
  readonly requestId: string;
  readonly correlationId: string;
  readonly metadata: AuditMetadata;
  readonly occurredAt: Date;
}

export interface ListAuditEventsInput {
  readonly limit?: number;
  readonly before?: Date;
}

export interface ValidatedListAuditEventsInput {
  readonly limit: number;
  readonly before: Date | null;
}

export interface AuditEventRepository {
  list(
    context: TrustedOrganizationContext,
    input: ValidatedListAuditEventsInput,
  ): Promise<readonly AuditEvent[]>;
}

export interface AuditSqlResult<Row> {
  readonly rows: readonly Row[];
}

export interface AuditSqlExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<AuditSqlResult<Row>>;
}
