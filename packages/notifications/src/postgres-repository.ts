import type { TrustedOrganizationContext } from '@green-hive/core';
import { NotificationError } from './errors.js';
import type { HiveNotification, NotificationEventType, NotificationRepository, NotificationSqlExecutor, NotificationStatus, ValidatedListNotificationsInput } from './types.js';

interface AuthorityRow extends Record<string, unknown> { readonly user_id: string | null; readonly app_code: string | null; readonly app_id: string | null; readonly organization_id: string | null; readonly trusted: boolean; readonly is_platform_admin: boolean; }
interface NotificationRow extends Record<string, unknown> { readonly id: string; readonly organization_id: string; readonly app_id: string; readonly project_id: string; readonly recipient_user_id: string; readonly job_id: string; readonly event_type: NotificationEventType; readonly title: string; readonly body: string; readonly status: NotificationStatus; readonly metadata: Readonly<Record<string, string>>; readonly created_at: Date | string; readonly read_at: Date | string | null; }

function date(value: Date | string | null): Date | null { if (value === null) return null; const result = value instanceof Date ? new Date(value.getTime()) : new Date(value); if (Number.isNaN(result.getTime())) throw new Error('Invalid notification timestamp'); return result; }
function map(row: NotificationRow): HiveNotification { const createdAt = date(row.created_at); if (!createdAt) throw new Error('Invalid notification timestamp'); return { id: row.id, organizationId: row.organization_id, appId: row.app_id, projectId: row.project_id, recipientUserId: row.recipient_user_id, jobId: row.job_id, eventType: row.event_type, title: row.title, body: row.body, status: row.status, metadata: row.metadata, createdAt, readAt: date(row.read_at) }; }

const COLUMNS = `id::text AS id, organization_id::text AS organization_id, app_id::text AS app_id, project_id::text AS project_id, recipient_user_id::text AS recipient_user_id, job_id::text AS job_id, event_type, title, body, status, metadata, created_at, read_at`;

export class PostgresNotificationRepository implements NotificationRepository {
  readonly #database: NotificationSqlExecutor;
  constructor(database: NotificationSqlExecutor) { this.#database = database; }
  async list(context: TrustedOrganizationContext, input: ValidatedListNotificationsInput): Promise<readonly HiveNotification[]> {
    const authority = await this.#authority(context);
    const result = await this.#database.query<NotificationRow>(`SELECT ${COLUMNS} FROM hive.notifications WHERE organization_id = $1::uuid AND app_id = $2::uuid AND recipient_user_id = $3::uuid ORDER BY created_at DESC, id DESC LIMIT $4`, [authority.organization_id, authority.app_id, authority.user_id, input.limit]);
    return result.rows.map(map);
  }
  async markRead(context: TrustedOrganizationContext, notificationId: string): Promise<HiveNotification | null> {
    const authority = await this.#authority(context);
    const result = await this.#database.query<NotificationRow>(`UPDATE hive.notifications SET status = 'READ', read_at = COALESCE(read_at, statement_timestamp()), updated_at = statement_timestamp() WHERE id = $1::uuid AND organization_id = $2::uuid AND app_id = $3::uuid AND recipient_user_id = $4::uuid RETURNING ${COLUMNS}`, [notificationId, authority.organization_id, authority.app_id, authority.user_id]);
    return result.rows[0] ? map(result.rows[0]) : null;
  }
  async #authority(context: TrustedOrganizationContext): Promise<AuthorityRow> {
    const result = await this.#database.query<AuthorityRow>(`SELECT auth.uid()::text AS user_id, hive.current_app_code() AS app_code, hive.current_app_id()::text AS app_id, hive.current_organization_id()::text AS organization_id, hive.has_trusted_organization_context() AS trusted, hive.is_platform_admin() AS is_platform_admin`);
    const authority = result.rows[0];
    if (!authority?.trusted || authority.is_platform_admin || authority.user_id !== context.userId || authority.app_code !== context.appCode || authority.organization_id !== context.organizationId || !authority.app_id) throw new NotificationError('NOTIFICATION_ACCESS_DENIED');
    return authority;
  }
}
