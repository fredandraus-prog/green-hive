import type { TrustedAppContext, TrustedOrganizationContext } from '@green-hive/core';
import { EntitlementError } from './errors.js';
import type { EntitlementRepository, ProjectEntitlement } from './types.js';
import {
  validateCapabilityCode,
  validateEntitlementProjectId,
  validateTrustedEntitlementContext,
} from './validation.js';

export class EntitlementService {
  readonly #repository: EntitlementRepository;

  constructor(repository: EntitlementRepository) {
    this.#repository = repository;
  }

  async can(
    context: TrustedAppContext,
    projectId: string,
    capabilityCode: string,
  ): Promise<boolean> {
    const trustedContext = this.#ownerContext(context);
    const validatedProjectId = validateEntitlementProjectId(projectId);
    const validatedCapabilityCode = validateCapabilityCode(capabilityCode);
    if (!validatedCapabilityCode.startsWith(`${trustedContext.appCode}_`)) return false;
    return this.#execute(() =>
      this.#repository.can(
        trustedContext,
        validatedProjectId,
        validatedCapabilityCode,
      ),
    );
  }

  async list(
    context: TrustedAppContext,
    projectId: string,
  ): Promise<readonly ProjectEntitlement[]> {
    const trustedContext = this.#ownerContext(context);
    const validatedProjectId = validateEntitlementProjectId(projectId);
    return this.#execute(() => this.#repository.list(trustedContext, validatedProjectId));
  }

  #ownerContext(context: TrustedAppContext): TrustedOrganizationContext {
    const trustedContext = validateTrustedEntitlementContext(context);
    if (trustedContext.platformRole === 'PLATFORM_ADMIN') {
      throw new EntitlementError('ENTITLEMENT_ACCESS_DENIED');
    }
    return trustedContext;
  }

  async #execute<Result>(operation: () => Promise<Result>): Promise<Result> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof EntitlementError) throw error;
      throw new EntitlementError('ENTITLEMENT_OPERATION_FAILED');
    }
  }
}
