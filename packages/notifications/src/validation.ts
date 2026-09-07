import type { TrustedOrganizationContext } from '@green-hive/core';
import { NotificationError } from './errors.js';
import type { ListNotificationsInput, ValidatedListNotificationsInput } from './types.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateNotificationContext(value: TrustedOrganizationContext): TrustedOrganizationContext {
  if (!value || typeof value.userId !== 'string' || typeof value.appCode !== 'string'
    || typeof value.organizationId !== 'string' || value.platformRole === 'PLATFORM_ADMIN') {
    throw new NotificationError('NOTIFICATION_ACCESS_DENIED');
  }
  return value;
}

export function validateListNotificationsInput(value: ListNotificationsInput = {}): ValidatedListNotificationsInput {
  if (!value || (value.limit !== undefined && (!Number.isInteger(value.limit) || value.limit < 1 || value.limit > 100))) {
    throw new NotificationError('NOTIFICATION_INVALID_INPUT');
  }
  return { limit: value.limit ?? 25 };
}

export function validateNotificationId(value: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new NotificationError('NOTIFICATION_INVALID_INPUT');
  return value;
}
