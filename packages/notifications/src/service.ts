import type { TrustedOrganizationContext } from '@green-hive/core';
import { NotificationError } from './errors.js';
import type { HiveNotification, ListNotificationsInput, NotificationRepository } from './types.js';
import { validateListNotificationsInput, validateNotificationContext, validateNotificationId } from './validation.js';

export class NotificationService {
  readonly #repository: NotificationRepository;
  constructor(repository: NotificationRepository) { this.#repository = repository; }

  async list(context: TrustedOrganizationContext, input: ListNotificationsInput = {}): Promise<readonly HiveNotification[]> {
    try { return await this.#repository.list(validateNotificationContext(context), validateListNotificationsInput(input)); }
    catch (error) { if (error instanceof NotificationError) throw error; throw new NotificationError('NOTIFICATION_OPERATION_FAILED'); }
  }

  async markRead(context: TrustedOrganizationContext, notificationId: string): Promise<HiveNotification> {
    try {
      const notification = await this.#repository.markRead(validateNotificationContext(context), validateNotificationId(notificationId));
      if (!notification) throw new NotificationError('NOTIFICATION_NOT_FOUND');
      return notification;
    } catch (error) { if (error instanceof NotificationError) throw error; throw new NotificationError('NOTIFICATION_OPERATION_FAILED'); }
  }
}
