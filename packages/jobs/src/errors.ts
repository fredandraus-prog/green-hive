export const JOB_ERROR_CODES = [
  'JOB_ACCESS_DENIED',
  'JOB_INVALID_INPUT',
  'JOB_NOT_FOUND',
  'JOB_NOT_REGISTERED',
  'JOB_ENTITLEMENT_REQUIRED',
  'JOB_IDEMPOTENCY_CONFLICT',
  'JOB_OPERATION_FAILED',
  'WORKER_INVALID_INPUT',
  'WORKER_LEASE_LOST',
  'WORKER_OPERATION_FAILED',
] as const;

export type JobErrorCode = (typeof JOB_ERROR_CODES)[number];

const SAFE_MESSAGES: Readonly<Record<JobErrorCode, string>> = Object.freeze({
  JOB_ACCESS_DENIED: 'Job operation is not permitted',
  JOB_INVALID_INPUT: 'Job input is invalid',
  JOB_NOT_FOUND: 'Job was not found',
  JOB_NOT_REGISTERED: 'Job type is not registered',
  JOB_ENTITLEMENT_REQUIRED: 'Project does not have the required capability',
  JOB_IDEMPOTENCY_CONFLICT: 'Idempotency key conflicts with an earlier job request',
  JOB_OPERATION_FAILED: 'Job operation could not be completed',
  WORKER_INVALID_INPUT: 'Worker input is invalid',
  WORKER_LEASE_LOST: 'Worker no longer owns the job lease',
  WORKER_OPERATION_FAILED: 'Worker operation could not be completed',
});

export class JobError extends Error {
  readonly code: JobErrorCode;

  constructor(code: JobErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = 'JobError';
    this.code = code;
  }
}
