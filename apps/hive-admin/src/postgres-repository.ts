import { OperationalAdminAccessError, type OperationalAdminOverview, type OperationalAdminRepository } from './index.js';

export interface AdminSqlExecutor {
  query<Row extends Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Row[] }>;
}

interface AuthorityRow extends Record<string, unknown> {
  readonly is_platform_admin: boolean;
}

interface OverviewRow extends Record<string, unknown> {
  readonly overview: unknown;
}

function count(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid admin count for ${field}`);
  return parsed;
}

function record(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid admin overview ${field}`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function buckets(value: unknown, field: string): Readonly<Record<string, number>> {
  return Object.freeze(Object.fromEntries(
    Object.entries(record(value, field)).map(([key, item]) => [key, count(item, `${field}.${key}`)]),
  ));
}

/** PostgreSQL read model. It must run through the authenticated session runner. */
export class PostgresOperationalAdminRepository implements OperationalAdminRepository {
  readonly #database: AdminSqlExecutor;

  constructor(database: AdminSqlExecutor) {
    this.#database = database;
  }

  async overview(): Promise<OperationalAdminOverview> {
    const authority = await this.#database.query<AuthorityRow>(
      'SELECT hive.is_platform_admin() AS is_platform_admin',
    );
    if (authority.rows[0]?.is_platform_admin !== true) throw new OperationalAdminAccessError();

    const result = await this.#database.query<OverviewRow>(
      'SELECT hive.operational_admin_overview() AS overview',
    );
    const row = result.rows[0];
    if (!row) throw new Error('Operational admin overview query returned no row');
    const overview = record(row.overview, 'overview');
    const projects = record(overview.projects, 'projects');
    return Object.freeze({
      users: count(overview.users, 'users'),
      workspaces: count(overview.workspaces, 'workspaces'),
      projects: Object.freeze({
        DRAFT: count(projects.DRAFT, 'projects.DRAFT'),
        ACTIVE: count(projects.ACTIVE, 'projects.ACTIVE'),
        ARCHIVED: count(projects.ARCHIVED, 'projects.ARCHIVED'),
        DELETED: count(projects.DELETED, 'projects.DELETED'),
      }),
      purchases: buckets(overview.purchases, 'purchases'),
      payments: buckets(overview.payments, 'payments'),
      jobs: buckets(overview.jobs, 'jobs'),
      budgets: buckets(overview.budgets, 'budgets'),
      costs: buckets(overview.costs, 'costs'),
      providerOperations: buckets(overview.providerOperations, 'providerOperations'),
    });
  }
}
