import { JobError, type JobErrorCode } from './errors.js';
import type {
  CompleteJobInput,
  FailJobInput,
  JobRetryPolicy,
  JobSqlExecutor,
  JobTimeoutClass,
  WorkerIdentity,
  WorkerLease,
  WorkerRecoveryResult,
  WorkerRepository,
} from './types.js';

interface WorkerLeaseRow extends Record<string, unknown> {
  readonly job_id: string;
  readonly organization_id: string;
  readonly app_id: string;
  readonly project_id: string;
  readonly owner_user_id: string;
  readonly job_type: string;
  readonly input_reference: string | null;
  readonly input_sha256: string;
  readonly attempt_count: number;
  readonly max_attempts: number;
  readonly retry_policy: JobRetryPolicy;
  readonly timeout_class: JobTimeoutClass;
  readonly correlation_id: string;
  readonly lease_token: string;
  readonly lease_expires_at: Date | string;
}

interface StatusRow extends Record<string, unknown> {
  readonly status: 'RETRYING' | 'FAILED';
}

interface RecoveryRow extends StatusRow {
  readonly job_id: string;
}

const DATABASE_CODES = new Set<JobErrorCode>([
  'WORKER_INVALID_INPUT',
  'WORKER_LEASE_LOST',
]);

function databaseWorkerError(error: unknown): JobError | null {
  if (!(error instanceof Error)) return null;
  const code = [...DATABASE_CODES].find((candidate) => error.message.includes(candidate));
  return code ? new JobError(code) : null;
}

function asDate(value: Date | string): Date {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid worker lease expiry');
  return parsed;
}

function mapLease(row: WorkerLeaseRow): WorkerLease {
  return {
    jobId: row.job_id,
    organizationId: row.organization_id,
    appId: row.app_id,
    projectId: row.project_id,
    ownerUserId: row.owner_user_id,
    jobType: row.job_type,
    inputReference: row.input_reference,
    inputHash: row.input_sha256,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    retryPolicy: row.retry_policy,
    timeoutClass: row.timeout_class,
    correlationId: row.correlation_id,
    leaseToken: row.lease_token,
    leaseExpiresAt: asDate(row.lease_expires_at),
  };
}

export class PostgresWorkerRepository implements WorkerRepository {
  readonly #database: JobSqlExecutor;

  constructor(database: JobSqlExecutor) {
    this.#database = database;
  }

  async claim(identity: WorkerIdentity, leaseSeconds: number): Promise<WorkerLease | null> {
    try {
      const result = await this.#database.query<WorkerLeaseRow>(
        'SELECT * FROM hive.claim_next_job($1::text, $2::integer)',
        [identity.workerId, leaseSeconds],
      );
      return result.rows[0] ? mapLease(result.rows[0]) : null;
    } catch (error) {
      throw databaseWorkerError(error) ?? error;
    }
  }

  async heartbeat(
    identity: WorkerIdentity,
    jobId: string,
    leaseToken: string,
    leaseSeconds: number,
  ): Promise<Date> {
    try {
      const result = await this.#database.query<{ lease_expires_at: Date | string }>(
        `SELECT hive.heartbeat_job($1::uuid, $2::text, $3::text, $4::integer)
           AS lease_expires_at`,
        [jobId, identity.workerId, leaseToken, leaseSeconds],
      );
      const expiry = result.rows[0]?.lease_expires_at;
      if (!expiry) throw new Error('Missing renewed lease expiry');
      return asDate(expiry);
    } catch (error) {
      throw databaseWorkerError(error) ?? error;
    }
  }

  async complete(identity: WorkerIdentity, input: CompleteJobInput): Promise<void> {
    try {
      await this.#database.query(
        'SELECT hive.complete_job($1::uuid, $2::text, $3::text, $4::text, $5::text)',
        [input.jobId, identity.workerId, input.leaseToken,
          input.outputHash ?? null, input.outputReference ?? null],
      );
    } catch (error) {
      throw databaseWorkerError(error) ?? error;
    }
  }

  async fail(identity: WorkerIdentity, input: FailJobInput): Promise<'RETRYING' | 'FAILED'> {
    try {
      const result = await this.#database.query<StatusRow>(
        `SELECT hive.fail_job($1::uuid, $2::text, $3::text, $4::text, $5::text)
           AS status`,
        [input.jobId, identity.workerId, input.leaseToken,
          input.failureKind, input.safeErrorCode],
      );
      const status = result.rows[0]?.status;
      if (status !== 'RETRYING' && status !== 'FAILED') throw new Error('Invalid failed job status');
      return status;
    } catch (error) {
      throw databaseWorkerError(error) ?? error;
    }
  }

  async cancel(identity: WorkerIdentity, jobId: string, leaseToken: string): Promise<void> {
    try {
      await this.#database.query(
        'SELECT hive.cancel_job($1::uuid, $2::text, $3::text)',
        [jobId, identity.workerId, leaseToken],
      );
    } catch (error) {
      throw databaseWorkerError(error) ?? error;
    }
  }

  async recoverExpired(batchLimit: number): Promise<readonly WorkerRecoveryResult[]> {
    try {
      const result = await this.#database.query<RecoveryRow>(
        'SELECT * FROM hive.recover_expired_job_leases($1::integer)',
        [batchLimit],
      );
      return result.rows.map((row) => ({ jobId: row.job_id, status: row.status }));
    } catch (error) {
      throw databaseWorkerError(error) ?? error;
    }
  }
}
