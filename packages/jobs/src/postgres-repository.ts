import type { TrustedOrganizationContext } from '@green-hive/core';
import { JobError, type JobErrorCode } from './errors.js';
import type {
  Job,
  JobRepository,
  JobRetryPolicy,
  JobSqlExecutor,
  JobStatus,
  JobTimeoutClass,
  ValidatedEnqueueJobInput,
} from './types.js';

interface AuthorityRow extends Record<string, unknown> {
  readonly user_id: string | null;
  readonly app_code: string | null;
  readonly app_id: string | null;
  readonly organization_id: string | null;
  readonly has_trusted_organization_context: boolean;
  readonly is_platform_admin: boolean;
}

interface JobRow extends Record<string, unknown> {
  readonly id: string;
  readonly organization_id: string;
  readonly app_id: string;
  readonly project_id: string;
  readonly owner_user_id: string;
  readonly job_type: string;
  readonly status: JobStatus;
  readonly priority: number;
  readonly attempt_count: number;
  readonly max_attempts: number;
  readonly retry_policy: JobRetryPolicy;
  readonly timeout_class: JobTimeoutClass;
  readonly correlation_id: string;
  readonly safe_error_code: string | null;
  readonly queued_at: Date | string;
  readonly available_at: Date | string;
  readonly started_at: Date | string | null;
  readonly completed_at: Date | string | null;
  readonly failed_at: Date | string | null;
  readonly cancelled_at: Date | string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

const JOB_COLUMNS = `
  id, organization_id, app_id, project_id, owner_user_id, job_type, status,
  priority, attempt_count, max_attempts, retry_policy, timeout_class, correlation_id,
  safe_error_code, queued_at, available_at, started_at, completed_at, failed_at,
  cancelled_at, created_at, updated_at`;

const DATABASE_CODES = new Set<JobErrorCode>([
  'JOB_ACCESS_DENIED',
  'JOB_INVALID_INPUT',
  'JOB_NOT_REGISTERED',
  'JOB_ENTITLEMENT_REQUIRED',
  'JOB_IDEMPOTENCY_CONFLICT',
]);

function asDate(value: Date | string, field: string): Date {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid ${field}`);
  return parsed;
}

function asOptionalDate(value: Date | string | null, field: string): Date | null {
  return value === null ? null : asDate(value, field);
}

function mapJob(row: JobRow): Job {
  return {
    id: row.id,
    organizationId: row.organization_id,
    appId: row.app_id,
    projectId: row.project_id,
    ownerUserId: row.owner_user_id,
    jobType: row.job_type,
    status: row.status,
    priority: row.priority,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    retryPolicy: row.retry_policy,
    timeoutClass: row.timeout_class,
    correlationId: row.correlation_id,
    safeErrorCode: row.safe_error_code,
    queuedAt: asDate(row.queued_at, 'queued_at'),
    availableAt: asDate(row.available_at, 'available_at'),
    startedAt: asOptionalDate(row.started_at, 'started_at'),
    completedAt: asOptionalDate(row.completed_at, 'completed_at'),
    failedAt: asOptionalDate(row.failed_at, 'failed_at'),
    cancelledAt: asOptionalDate(row.cancelled_at, 'cancelled_at'),
    createdAt: asDate(row.created_at, 'created_at'),
    updatedAt: asDate(row.updated_at, 'updated_at'),
  };
}

function databaseJobError(error: unknown): JobError | null {
  if (!(error instanceof Error)) return null;
  const code = [...DATABASE_CODES].find((candidate) => error.message.includes(candidate));
  return code ? new JobError(code) : null;
}

export class PostgresJobRepository implements JobRepository {
  readonly #database: JobSqlExecutor;

  constructor(database: JobSqlExecutor) {
    this.#database = database;
  }

  async enqueue(
    context: TrustedOrganizationContext,
    input: ValidatedEnqueueJobInput,
  ): Promise<Job> {
    await this.#assertAuthority(context);
    try {
      const created = await this.#database.query<{ id: string }>(
        `SELECT hive.enqueue_project_job(
           $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::integer
         )::text AS id`,
        [
          input.projectId,
          input.jobType,
          input.idempotencyKey,
          input.inputHash,
          input.inputReference,
          input.priority,
        ],
      );
      const jobId = created.rows[0]?.id;
      if (!jobId) throw new Error('Missing job id');
      const job = await this.get(context, input.projectId, jobId);
      if (!job) throw new Error('Missing enqueued job');
      return job;
    } catch (error) {
      throw databaseJobError(error) ?? error;
    }
  }

  async get(
    context: TrustedOrganizationContext,
    projectId: string,
    jobId: string,
  ): Promise<Job | null> {
    const authority = await this.#assertAuthority(context);
    const result = await this.#database.query<JobRow>(
      `SELECT ${JOB_COLUMNS}
       FROM hive.jobs
       WHERE id = $1::uuid
         AND project_id = $2::uuid
         AND owner_user_id = $3::uuid
         AND app_id = $4::uuid
         AND organization_id = $5::uuid`,
      [jobId, projectId, context.userId, authority.app_id, authority.organization_id],
    );
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  }

  async #assertAuthority(context: TrustedOrganizationContext): Promise<AuthorityRow> {
    const result = await this.#database.query<AuthorityRow>(
      `SELECT
         auth.uid()::text AS user_id,
         hive.current_app_code() AS app_code,
         hive.current_app_id()::text AS app_id,
         hive.current_organization_id()::text AS organization_id,
         hive.has_trusted_organization_context() AS has_trusted_organization_context,
         hive.is_platform_admin() AS is_platform_admin`,
    );
    const authority = result.rows[0];
    if (
      !authority?.app_id
      || !authority.organization_id
      || !authority.has_trusted_organization_context
      || authority.is_platform_admin
      || authority.user_id !== context.userId
      || authority.app_code !== context.appCode
      || authority.organization_id !== context.organizationId
    ) {
      throw new JobError('JOB_ACCESS_DENIED');
    }
    return authority;
  }
}
