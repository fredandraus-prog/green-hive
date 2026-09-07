export const NOTIFICATION_ERROR_CODES = [
  'NOTIFICATION_ACCESS_DENIED',
  'NOTIFICATION_INVALID_INPUT',
  'NOTIFICATION_NOT_FOUND',
  'NOTIFICATION_OPERATION_FAILED',
] as const;

export type NotificationErrorCode = (typeof NOTIFICATION_ERROR_CODES)[number];

const SAFE_MESSAGES: Readonly<Record<NotificationErrorCode, string>> = {
  NOTIFICATION_ACCESS_DENIED: 'Notification access is not permitted',
  NOTIFICATION_INVALID_INPUT: 'Notification input is invalid',
  NOTIFICATION_NOT_FOUND: 'Notification was not found',
  NOTIFICATION_OPERATION_FAILED: 'Notification operation could not be completed',
};

export class NotificationError extends Error {
  readonly code: NotificationErrorCode;

  constructor(code: NotificationErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = 'NotificationError';
    this.code = code;
  }
}
