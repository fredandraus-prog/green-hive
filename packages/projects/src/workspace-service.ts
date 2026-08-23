import type { TrustedAppContext } from '@green-hive/core';
import { WorkspaceError } from './workspace-errors.js';
import type {
  AddWorkspaceMemberInput,
  CreateSharedWorkspaceInput,
  RenameWorkspaceInput,
  Workspace,
  WorkspaceMember,
  WorkspaceRepository,
} from './workspace-types.js';
import {
  validateAddWorkspaceMemberInput,
  validateCreateSharedWorkspaceInput,
  validatePersonalWorkspaceName,
  validateRenameWorkspaceInput,
  validateWorkspaceContext,
  validateWorkspaceOrganizationContext,
} from './workspace-validation.js';

export class WorkspaceService {
  readonly #repository: WorkspaceRepository;

  constructor(repository: WorkspaceRepository) {
    this.#repository = repository;
  }

  async ensurePersonal(
    context: TrustedAppContext,
    name = 'Personal Workspace',
  ): Promise<Workspace> {
    const trustedContext = validateWorkspaceContext(context);
    this.#assertMemberOperation(trustedContext);
    const validatedName = validatePersonalWorkspaceName(name);
    return this.#execute(() => this.#repository.ensurePersonal(trustedContext, validatedName));
  }

  async list(context: TrustedAppContext): Promise<readonly Workspace[]> {
    const trustedContext = validateWorkspaceContext(context);
    this.#assertMemberOperation(trustedContext);
    return this.#execute(() => this.#repository.list(trustedContext));
  }

  async createShared(
    context: TrustedAppContext,
    input: CreateSharedWorkspaceInput,
  ): Promise<Workspace> {
    const trustedContext = validateWorkspaceContext(context);
    this.#assertMemberOperation(trustedContext);
    const name = validateCreateSharedWorkspaceInput(input);
    return this.#execute(() => this.#repository.createShared(trustedContext, name));
  }

  async rename(
    context: TrustedAppContext,
    input: RenameWorkspaceInput,
  ): Promise<Workspace> {
    const trustedContext = validateWorkspaceOrganizationContext(context);
    this.#assertMemberOperation(trustedContext);
    const name = validateRenameWorkspaceInput(input);
    return this.#execute(() => this.#repository.rename(trustedContext, name));
  }

  async listMembers(context: TrustedAppContext): Promise<readonly WorkspaceMember[]> {
    const trustedContext = validateWorkspaceOrganizationContext(context);
    this.#assertMemberOperation(trustedContext);
    return this.#execute(() => this.#repository.listMembers(trustedContext));
  }

  async addMember(
    context: TrustedAppContext,
    input: AddWorkspaceMemberInput,
  ): Promise<WorkspaceMember> {
    const trustedContext = validateWorkspaceOrganizationContext(context);
    this.#assertMemberOperation(trustedContext);
    const validatedInput = validateAddWorkspaceMemberInput(input);
    return this.#execute(() => this.#repository.addMember(trustedContext, validatedInput));
  }

  #assertMemberOperation(context: TrustedAppContext): void {
    if (context.platformRole === 'PLATFORM_ADMIN') {
      throw new WorkspaceError('WORKSPACE_ACCESS_DENIED');
    }
  }

  async #execute<Result>(operation: () => Promise<Result>): Promise<Result> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof WorkspaceError) throw error;
      throw new WorkspaceError('WORKSPACE_OPERATION_FAILED');
    }
  }
}
