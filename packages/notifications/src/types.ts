import type { TrustedOrganizationContext } from '@green-hive/core';

export const NOTIFICATION_STATUSES = ['UNREAD', 'READ'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const NOTIFICATION_EVENT_TYPES = ['JOB_COMPLETED'] as const;
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export interface HiveNotification {
  readonly id: string;
  readonly organizationId: string;
  readonly appId: string;
  readonly projectId: string;
  readonly recipientUserId: string;
  readonly jobId: string;
  readonly eventType: NotificationEventType;
  readonly title: string;
  readonly body: string;
  readonly status: NotificationStatus;
  readonly metadata: Readonly<Record<string, string>>;
  readonly createdAt: Date;
  readonly readAt: Date | null;
}

export interface ListNotificationsInput { readonly limit?: number; }
export interface ValidatedListNotificationsInput { readonly limit: number; }

export interface NotificationRepository {
  list(context: TrustedOrganizationContext, input: ValidatedListNotificationsInput): Promise<readonly HiveNotification[]>;
  markRead(context: TrustedOrganizationContext, notificationId: string): Promise<HiveNotification | null>;
}

export interface NotificationSqlResult<Row> { readonly rows: readonly Row[]; }
export interface NotificationSqlExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string, parameters?: readonly unknown[],
  ): Promise<NotificationSqlResult<Row>>;
}
