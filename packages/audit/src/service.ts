import type { TrustedOrganizationContext } from '@green-hive/core';
import { AuditError } from './errors.js';
import type { AuditEvent, AuditEventRepository, ListAuditEventsInput } from './types.js';
import { validateAuditContext, validateListAuditEventsInput } from './validation.js';

export class AuditService {
  readonly #repository: AuditEventRepository;

  constructor(repository: AuditEventRepository) {
    this.#repository = repository;
  }

  async list(
    context: TrustedOrganizationContext,
    input: ListAuditEventsInput = {},
  ): Promise<readonly AuditEvent[]> {
    const trustedContext = validateAuditContext(context);
    if (trustedContext.platformRole === 'PLATFORM_ADMIN') {
      throw new AuditError('AUDIT_ACCESS_DENIED');
    }
    const validatedInput = validateListAuditEventsInput(input);
    try {
      return await this.#repository.list(trustedContext, validatedInput);
    } catch (error) {
      if (error instanceof AuditError) throw error;
      throw new AuditError('AUDIT_OPERATION_FAILED');
    }
  }
}
