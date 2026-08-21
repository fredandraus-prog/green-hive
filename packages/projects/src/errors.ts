export const PROJECT_ERROR_CODES = [
  'PROJECT_NOT_FOUND',
  'PROJECT_ACCESS_DENIED',
  'INVALID_PROJECT_TRANSITION',
  'INVALID_PROJECT_INPUT',
  'PROJECT_OPERATION_FAILED',
] as const;

export type ProjectErrorCode = (typeof PROJECT_ERROR_CODES)[number];

const SAFE_MESSAGES: Readonly<Record<ProjectErrorCode, string>> = Object.freeze({
  PROJECT_NOT_FOUND: 'Project was not found',
  PROJECT_ACCESS_DENIED: 'Project operation is not permitted',
  INVALID_PROJECT_TRANSITION: 'Project lifecycle transition is not permitted',
  INVALID_PROJECT_INPUT: 'Project input is invalid',
  PROJECT_OPERATION_FAILED: 'Project operation could not be completed',
});

export class ProjectError extends Error {
  readonly code: ProjectErrorCode;

  constructor(code: ProjectErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = 'ProjectError';
    this.code = code;
  }
}
