export type NotificationStatus = 'UNREAD' | 'READ';
export interface HiveNotification { readonly id: string; readonly userId: string; readonly eventType: string; readonly status: NotificationStatus; }
