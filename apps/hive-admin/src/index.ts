import type { TrustedAppContext } from '@green-hive/core';
export { PostgresOperationalAdminRepository, type AdminSqlExecutor } from './postgres-repository.js';

/**
 * The operational Admin is intentionally read-only. It may expose only
 * bounded counters and safe status classifications, never application content.
 */
export interface OperationalAdminOverview {
  readonly users: number;
  readonly workspaces: number;
  readonly projects: Readonly<Record<'DRAFT' | 'ACTIVE' | 'ARCHIVED' | 'DELETED', number>>;
  readonly purchases: Readonly<Record<string, number>>;
  readonly payments: Readonly<Record<string, number>>;
  readonly jobs: Readonly<Record<string, number>>;
  readonly budgets: Readonly<Record<string, number>>;
  readonly costs: Readonly<Record<string, number>>;
  readonly providerOperations: Readonly<Record<string, number>>;
}

export interface OperationalAdminRepository {
  overview(): Promise<OperationalAdminOverview>;
}

export class OperationalAdminAccessError extends Error {
  readonly code = 'ADMIN_ACCESS_DENIED' as const;
  constructor() {
    super('A verified platform-admin context is required for operational inspection');
    this.name = 'OperationalAdminAccessError';
  }
}

export class OperationalAdminService {
  readonly #repository: OperationalAdminRepository;

  constructor(repository: OperationalAdminRepository) {
    this.#repository = repository;
  }

  async overview(context: TrustedAppContext): Promise<OperationalAdminOverview> {
    if (context.platformRole !== 'PLATFORM_ADMIN') throw new OperationalAdminAccessError();
    return this.#repository.overview();
  }
}

export const HIVE_ADMIN_STATUS = 'READ_ONLY_OPERATIONAL_FOUNDATION' as const;
