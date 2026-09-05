export const FILE_ERROR_CODES = [
  'FILE_ACCESS_DENIED',
  'FILE_INVALID_INPUT',
  'FILE_NOT_FOUND',
  'FILE_ENTITLEMENT_REQUIRED',
  'FILE_IDEMPOTENCY_CONFLICT',
  'FILE_INVALID_TRANSITION',
  'FILE_STORAGE_CONFLICT',
  'FILE_STORAGE_FAILED',
  'FILE_CONFIGURATION_INVALID',
  'FILE_OPERATION_FAILED',
] as const;

export type FileErrorCode = (typeof FILE_ERROR_CODES)[number];

const SAFE_MESSAGES: Readonly<Record<FileErrorCode, string>> = Object.freeze({
  FILE_ACCESS_DENIED: 'File operation is not permitted',
  FILE_INVALID_INPUT: 'File input is invalid',
  FILE_NOT_FOUND: 'File was not found',
  FILE_ENTITLEMENT_REQUIRED: 'Project does not have the required file capability',
  FILE_IDEMPOTENCY_CONFLICT: 'File idempotency key conflicts with an earlier request',
  FILE_INVALID_TRANSITION: 'File lifecycle transition is not permitted',
  FILE_STORAGE_CONFLICT: 'Private file storage contains conflicting data',
  FILE_STORAGE_FAILED: 'Private file storage operation could not be completed',
  FILE_CONFIGURATION_INVALID: 'File service configuration is invalid',
  FILE_OPERATION_FAILED: 'File operation could not be completed',
});

export class FileError extends Error {
  readonly code: FileErrorCode;

  constructor(code: FileErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = 'FileError';
    this.code = code;
  }
}
