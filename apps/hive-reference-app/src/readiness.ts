export const REFERENCE_APP_EXPECTED_MIGRATION_VERSION = 11;

interface ReadinessRow extends Record<string, unknown> {
  readonly migration_count: number;
  readonly migration_version: number;
  readonly reference_app_count: number;
  readonly projects_ready: boolean;
  readonly audit_ready: boolean;
  readonly app_helper_ready: boolean;
  readonly organization_helper_ready: boolean;
}

export interface ReadinessDatabase {
  query<Row extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Row[] }>;
}

export function createReferenceAppReadinessCheck(database: ReadinessDatabase): () => Promise<void> {
  return async () => {
    const result = await database.query<ReadinessRow>(
      `SELECT
         (SELECT count(*)::integer FROM hive.schema_migrations) AS migration_count,
         (SELECT coalesce(max(version), 0)::integer FROM hive.schema_migrations) AS migration_version,
         (SELECT count(*)::integer
            FROM hive.apps
           WHERE id = $1::uuid
             AND app_code = 'REFERENCE_APP'
             AND status = 'INTERNAL') AS reference_app_count,
         to_regclass('hive.projects') IS NOT NULL AS projects_ready,
         to_regclass('audit.events') IS NOT NULL AS audit_ready,
         to_regprocedure('hive.current_app_code()') IS NOT NULL AS app_helper_ready,
         to_regprocedure('hive.current_organization_id()') IS NOT NULL AS organization_helper_ready`,
      ['00000000-0000-4000-8000-000000000001'],
    );
    const state = result.rows[0];
    if (
      !state ||
      state.migration_count !== REFERENCE_APP_EXPECTED_MIGRATION_VERSION ||
      state.migration_version !== REFERENCE_APP_EXPECTED_MIGRATION_VERSION ||
      state.reference_app_count !== 1 ||
      !state.projects_ready ||
      !state.audit_ready ||
      !state.app_helper_ready ||
      !state.organization_helper_ready
    ) {
      throw new Error('Green Hive database baseline is not ready');
    }
  };
}
