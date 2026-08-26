import type { TrustedOrganizationContext } from '@green-hive/core';

export const JOB_STATUSES = [
  'QUEUED',
  'RUNNING',
  'RETRYING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_RETRY_POLICIES = ['NONE', 'FIXED', 'EXPONENTIAL_BACKOFF'] as const;
export type JobRetryPolicy = (typeof JOB_RETRY_POLICIES)[number];

export const JOB_TIMEOUT_CLASSES = ['SHORT', 'MEDIUM', 'LONG'] as const;
export type JobTimeoutClass = (typeof JOB_TIMEOUT_CLASSES)[number];

export const WORKER_FAILURE_KINDS = ['TRANSIENT', 'PERMANENT'] as const;
export type WorkerFailureKind = (typeof WORKER_FAILURE_KINDS)[number];

export interface JobRegistration {
  readonly id: string;
  readonly appId: string;
  readonly jobType: string;
  readonly handlerOwner: string;
  readonly requiredCapability: string | null;
  readonly costBudgetType: string | null;
  readonly exclusiveScope: string | null;
  readonly idempotencyStrategy: string;
  readonly retryPolicy: JobRetryPolicy;
  readonly maxAttempts: number;
  readonly timeoutClass: JobTimeoutClass;
  readonly active: boolean;
}

/** Sanitized status projection. It intentionally excludes input and idempotency hashes. */
export interface Job {
  readonly id: string;
  readonly organizationId: string;
  readonly appId: string;
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly jobType: string;
  readonly status: JobStatus;
  readonly priority: number;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly retryPolicy: JobRetryPolicy;
  readonly timeoutClass: JobTimeoutClass;
  readonly correlationId: string;
  readonly safeErrorCode: string | null;
  readonly queuedAt: Date;
  readonly availableAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly failedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface EnqueueJobInput {
  readonly projectId: string;
  readonly jobType: string;
  readonly idempotencyKey: string;
  /** SHA-256 of the validated domain input. Raw payloads remain outside the queue. */
  readonly inputHash: string;
  readonly inputReference?: string;
  readonly priority?: number;
}

export interface ValidatedEnqueueJobInput {
  readonly projectId: string;
  readonly jobType: string;
  readonly idempotencyKey: string;
  readonly inputHash: string;
  readonly inputReference: string | null;
  readonly priority: number;
}

export interface JobRepository {
  enqueue(context: TrustedOrganizationContext, input: ValidatedEnqueueJobInput): Promise<Job>;
  get(
    context: TrustedOrganizationContext,
    projectId: string,
    jobId: string,
  ): Promise<Job | null>;
}

export interface JobSqlResult<Row> {
  readonly rows: readonly Row[];
}

export interface JobSqlExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<JobSqlResult<Row>>;
}

/** Server-only identity assigned by the trusted worker runtime. */
export interface WorkerIdentity {
  readonly workerId: string;
}

/** A claimed job. The raw lease token is returned once and must never be logged or persisted. */
export interface WorkerLease {
  readonly jobId: string;
  readonly organizationId: string;
  readonly appId: string;
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly jobType: string;
  readonly inputReference: string | null;
  readonly inputHash: string;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly retryPolicy: JobRetryPolicy;
  readonly timeoutClass: JobTimeoutClass;
  readonly correlationId: string;
  readonly leaseToken: string;
  readonly leaseExpiresAt: Date;
}

export interface CompleteJobInput {
  readonly jobId: string;
  readonly leaseToken: string;
  readonly outputHash?: string;
  readonly outputReference?: string;
}

export interface FailJobInput {
  readonly jobId: string;
  readonly leaseToken: string;
  readonly failureKind: WorkerFailureKind;
  readonly safeErrorCode: string;
}

export interface WorkerRecoveryResult {
  readonly jobId: string;
  readonly status: 'RETRYING' | 'FAILED';
}

export interface WorkerRepository {
  claim(identity: WorkerIdentity, leaseSeconds: number): Promise<WorkerLease | null>;
  heartbeat(identity: WorkerIdentity, jobId: string, leaseToken: string, leaseSeconds: number): Promise<Date>;
  complete(identity: WorkerIdentity, input: CompleteJobInput): Promise<void>;
  fail(identity: WorkerIdentity, input: FailJobInput): Promise<'RETRYING' | 'FAILED'>;
  cancel(identity: WorkerIdentity, jobId: string, leaseToken: string): Promise<void>;
  recoverExpired(batchLimit: number): Promise<readonly WorkerRecoveryResult[]>;
}
