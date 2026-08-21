export const WORKSPACE_ERROR_CODES = [
  'WORKSPACE_NOT_FOUND',
  'WORKSPACE_ACCESS_DENIED',
  'INVALID_WORKSPACE_INPUT',
  'WORKSPACE_OPERATION_FAILED',
] as const;

export type WorkspaceErrorCode = (typeof WORKSPACE_ERROR_CODES)[number];

const SAFE_MESSAGES: Readonly<Record<WorkspaceErrorCode, string>> = Object.freeze({
  WORKSPACE_NOT_FOUND: 'Workspace was not found',
  WORKSPACE_ACCESS_DENIED: 'Workspace operation is not permitted',
  INVALID_WORKSPACE_INPUT: 'Workspace input is invalid',
  WORKSPACE_OPERATION_FAILED: 'Workspace operation could not be completed',
});

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;

  constructor(code: WorkspaceErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = 'WorkspaceError';
    this.code = code;
  }
}
