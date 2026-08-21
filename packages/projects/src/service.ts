import type { TrustedAppContext } from '@green-hive/core';
import { ProjectError } from './errors.js';
import type { CreateProjectInput, Project, ProjectRepository } from './types.js';
import {
  validateCreateProjectInput,
  validateProjectId,
  validateTrustedProjectContext,
} from './validation.js';

export class ProjectService {
  readonly #repository: ProjectRepository;

  constructor(repository: ProjectRepository) {
    this.#repository = repository;
  }

  async create(context: TrustedAppContext, input: CreateProjectInput): Promise<Project> {
    const trustedContext = validateTrustedProjectContext(context);
    this.#assertOwnerAccess(trustedContext);
    const validatedInput = validateCreateProjectInput(input);
    return this.#execute(() => this.#repository.create(trustedContext, validatedInput));
  }

  async list(context: TrustedAppContext): Promise<readonly Project[]> {
    const trustedContext = validateTrustedProjectContext(context);
    this.#assertOwnerAccess(trustedContext);
    return this.#execute(() => this.#repository.list(trustedContext));
  }

  async get(context: TrustedAppContext, projectId: string): Promise<Project> {
    const trustedContext = validateTrustedProjectContext(context);
    this.#assertOwnerAccess(trustedContext);
    const validatedProjectId = validateProjectId(projectId);
    const project = await this.#execute(() =>
      this.#repository.get(trustedContext, validatedProjectId),
    );
    if (!project) throw new ProjectError('PROJECT_NOT_FOUND');
    return project;
  }

  async archive(context: TrustedAppContext, projectId: string): Promise<Project> {
    const trustedContext = validateTrustedProjectContext(context);
    this.#assertOwnerAccess(trustedContext);
    const validatedProjectId = validateProjectId(projectId);
    const project = await this.#execute(() =>
      this.#repository.archive(trustedContext, validatedProjectId),
    );
    if (!project) throw new ProjectError('PROJECT_NOT_FOUND');
    return project;
  }

  async softDelete(context: TrustedAppContext, projectId: string): Promise<void> {
    const trustedContext = validateTrustedProjectContext(context);
    this.#assertOwnerAccess(trustedContext);
    const validatedProjectId = validateProjectId(projectId);
    await this.#execute(() => this.#repository.softDelete(trustedContext, validatedProjectId));
  }

  #assertOwnerAccess(context: TrustedAppContext): void {
    if (context.platformRole === 'PLATFORM_ADMIN') {
      throw new ProjectError('PROJECT_ACCESS_DENIED');
    }
  }

  async #execute<Result>(operation: () => Promise<Result>): Promise<Result> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ProjectError) throw error;
      throw new ProjectError('PROJECT_OPERATION_FAILED');
    }
  }
}
