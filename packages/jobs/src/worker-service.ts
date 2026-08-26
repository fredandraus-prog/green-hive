import { JobError } from './errors.js';
import type {
  CompleteJobInput,
  FailJobInput,
  WorkerIdentity,
  WorkerLease,
  WorkerRecoveryResult,
  WorkerRepository,
} from './types.js';
import {
  validateBatchLimit,
  validateCompleteJobInput,
  validateFailJobInput,
  validateLeaseSeconds,
  validateLeaseToken,
  validateWorkerIdentity,
  validateWorkerJobId,
} from './worker-validation.js';

/** Server-side worker lifecycle boundary. It must run with a service-role database session. */
export class WorkerService {
  readonly #repository: WorkerRepository;

  constructor(repository: WorkerRepository) {
    this.#repository = repository;
  }

  claim(identity: WorkerIdentity, leaseSeconds = 300): Promise<WorkerLease | null> {
    return this.#execute(() => this.#repository.claim(
      validateWorkerIdentity(identity), validateLeaseSeconds(leaseSeconds),
    ));
  }

  heartbeat(identity: WorkerIdentity, jobId: string, leaseToken: string, leaseSeconds = 300): Promise<Date> {
    return this.#execute(() => this.#repository.heartbeat(
      validateWorkerIdentity(identity), validateWorkerJobId(jobId),
      validateLeaseToken(leaseToken), validateLeaseSeconds(leaseSeconds),
    ));
  }

  complete(identity: WorkerIdentity, input: CompleteJobInput): Promise<void> {
    return this.#execute(() => this.#repository.complete(
      validateWorkerIdentity(identity), validateCompleteJobInput(input),
    ));
  }

  fail(identity: WorkerIdentity, input: FailJobInput): Promise<'RETRYING' | 'FAILED'> {
    return this.#execute(() => this.#repository.fail(
      validateWorkerIdentity(identity), validateFailJobInput(input),
    ));
  }

  cancel(identity: WorkerIdentity, jobId: string, leaseToken: string): Promise<void> {
    return this.#execute(() => this.#repository.cancel(
      validateWorkerIdentity(identity), validateWorkerJobId(jobId), validateLeaseToken(leaseToken),
    ));
  }

  recoverExpired(batchLimit = 100): Promise<readonly WorkerRecoveryResult[]> {
    return this.#execute(() => this.#repository.recoverExpired(validateBatchLimit(batchLimit)));
  }

  async #execute<Result>(operation: () => Promise<Result>): Promise<Result> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof JobError) throw error;
      throw new JobError('WORKER_OPERATION_FAILED');
    }
  }
}
