import type { TrustedAppContext, TrustedOrganizationContext } from '@green-hive/core';
import { JobError } from './errors.js';
import type { EnqueueJobInput, Job, JobRepository } from './types.js';
import {
  validateEnqueueJobInput,
  validateJobId,
  validateJobProjectId,
  validateTrustedJobContext,
} from './validation.js';

/** Server-side queue boundary. Worker lifecycle transitions belong to GH-0404. */
export class JobService {
  readonly #repository: JobRepository;

  constructor(repository: JobRepository) {
    this.#repository = repository;
  }

  async enqueue(context: TrustedAppContext, input: EnqueueJobInput): Promise<Job> {
    const trustedContext = this.#ownerContext(context);
    const validatedInput = validateEnqueueJobInput(input);
    if (!validatedInput.jobType.startsWith(`${trustedContext.appCode}_`)) {
      throw new JobError('JOB_INVALID_INPUT');
    }
    return this.#execute(() => this.#repository.enqueue(trustedContext, validatedInput));
  }

  async get(context: TrustedAppContext, projectId: string, jobId: string): Promise<Job> {
    const trustedContext = this.#ownerContext(context);
    const job = await this.#execute(() =>
      this.#repository.get(
        trustedContext,
        validateJobProjectId(projectId),
        validateJobId(jobId),
      ),
    );
    if (!job) throw new JobError('JOB_NOT_FOUND');
    return job;
  }

  #ownerContext(context: TrustedAppContext): TrustedOrganizationContext {
    const trustedContext = validateTrustedJobContext(context);
    if (trustedContext.platformRole === 'PLATFORM_ADMIN') {
      throw new JobError('JOB_ACCESS_DENIED');
    }
    return trustedContext;
  }

  async #execute<Result>(operation: () => Promise<Result>): Promise<Result> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof JobError) throw error;
      throw new JobError('JOB_OPERATION_FAILED');
    }
  }
}
