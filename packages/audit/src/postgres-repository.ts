import type { TrustedOrganizationContext } from '@green-hive/core';
import { AuditError } from './errors.js';
import type {
  AuditActorType,
  AuditEvent,
  AuditEventCode,
  AuditEventRepository,
  AuditMetadata,
  AuditOutcome,
  AuditSqlExecutor,
  AuditSubjectType,
  ValidatedListAuditEventsInput,
} from './types.js';

interface AuditAuthorityRow extends Record<string, unknown> {
  readonly user_id: string | null;
  readonly app_code: string | null;
  readonly app_id: string | null;
  readonly organization_id: string | null;
  readonly trusted: boolean;
  readonly is_platform_admin: boolean;
}

interface AuditEventRow extends Record<string, unknown> {
  readonly id: string;
  readonly event_code: AuditEventCode;
  readonly actor_user_id: string | null;
  readonly actor_type: AuditActorType;
  readonly organization_id: string | null;
  readonly app_id: string | null;
  readonly project_id: string | null;
  readonly subject_type: AuditSubjectType;
  readonly subject_id: string | null;
  readonly outcome: AuditOutcome;
  readonly request_id: string;
  readonly correlation_id: string;
  readonly metadata: AuditMetadata;
  readonly occurred_at: Date | string;
}

function mapEvent(row: AuditEventRow): AuditEvent {
  const occurredAt = row.occurred_at instanceof Date
    ? new Date(row.occurred_at.getTime())
    : new Date(row.occurred_at);
  if (Number.isNaN(occurredAt.getTime())) throw new Error('Invalid audit timestamp');
  return {
    id: row.id,
    eventCode: row.event_code,
    actorUserId: row.actor_user_id,
    actorType: row.actor_type,
    organizationId: row.organization_id,
    appId: row.app_id,
    projectId: row.project_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    outcome: row.outcome,
    requestId: row.request_id,
    correlationId: row.correlation_id,
    metadata: row.metadata,
    occurredAt,
  };
}

export class PostgresAuditEventRepository implements AuditEventRepository {
  readonly #database: AuditSqlExecutor;

  constructor(database: AuditSqlExecutor) {
    this.#database = database;
  }

  async list(
    context: TrustedOrganizationContext,
    input: ValidatedListAuditEventsInput,
  ): Promise<readonly AuditEvent[]> {
    const authority = await this.#authority(context);
    const result = await this.#database.query<AuditEventRow>(
      `SELECT
         id::text AS id,
         event_code,
         actor_user_id::text AS actor_user_id,
         actor_type,
         organization_id::text AS organization_id,
         app_id::text AS app_id,
         project_id::text AS project_id,
         subject_type,
         subject_id::text AS subject_id,
         outcome,
         request_id::text AS request_id,
         correlation_id::text AS correlation_id,
         metadata,
         occurred_at
       FROM audit.events
       WHERE organization_id = $1::uuid
         AND app_id = $2::uuid
         AND ($3::timestamptz IS NULL OR occurred_at < $3::timestamptz)
       ORDER BY occurred_at DESC, id DESC
       LIMIT $4`,
      [authority.organization_id, authority.app_id, input.before, input.limit],
    );
    return result.rows.map(mapEvent);
  }

  async #authority(context: TrustedOrganizationContext): Promise<AuditAuthorityRow> {
    const result = await this.#database.query<AuditAuthorityRow>(
      `SELECT
         auth.uid()::text AS user_id,
         hive.current_app_code() AS app_code,
         hive.current_app_id()::text AS app_id,
         hive.current_organization_id()::text AS organization_id,
         hive.has_trusted_organization_context() AS trusted,
         hive.is_platform_admin() AS is_platform_admin`,
    );
    const authority = result.rows[0];
    if (
      !authority?.trusted ||
      authority.is_platform_admin ||
      authority.user_id !== context.userId ||
      authority.app_code !== context.appCode ||
      authority.organization_id !== context.organizationId ||
      !authority.app_id
    ) {
      throw new AuditError('AUDIT_ACCESS_DENIED');
    }
    return authority;
  }
}
