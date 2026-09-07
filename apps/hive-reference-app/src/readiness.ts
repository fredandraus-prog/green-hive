export const REFERENCE_APP_EXPECTED_MIGRATION_VERSION = 25;

interface ReadinessRow extends Record<string, unknown> {
  readonly migration_count: number;
  readonly migration_version: number;
  readonly reference_app_count: number;
  readonly reference_product_count: number;
  readonly reference_price_count: number;
  readonly projects_ready: boolean;
  readonly audit_ready: boolean;
  readonly billing_catalog_ready: boolean;
  readonly billing_purchase_ready: boolean;
  readonly billing_function_ready: boolean;
  readonly billing_provider_ready: boolean;
  readonly billing_webhook_ready: boolean;
  readonly entitlement_mapping_count: number;
  readonly entitlements_ready: boolean;
  readonly usage_cost_ready: boolean;
  readonly cost_guard_ready: boolean;
  readonly reference_job_registration_count: number;
  readonly jobs_ready: boolean;
  readonly workers_ready: boolean;
  readonly ai_gateway_ready: boolean;
  readonly search_gateway_ready: boolean;
  readonly files_ready: boolean;
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
         (SELECT count(*)::integer
            FROM hive.products
           WHERE id = $2::uuid
             AND app_id = $1::uuid
             AND product_code = 'REFERENCE_APP_SANDBOX'
             AND active) AS reference_product_count,
         (SELECT count(*)::integer
            FROM hive.prices
           WHERE id = $3::uuid
             AND product_id = $2::uuid
             AND app_id = $1::uuid
             AND version = 1
             AND currency = 'BRL'
             AND amount = 0.000000
             AND active) AS reference_price_count,
         to_regclass('hive.projects') IS NOT NULL AS projects_ready,
         to_regclass('audit.events') IS NOT NULL AS audit_ready,
         to_regclass('hive.products') IS NOT NULL
           AND to_regclass('hive.prices') IS NOT NULL AS billing_catalog_ready,
         to_regclass('hive.purchases') IS NOT NULL
           AND to_regclass('hive.payments') IS NOT NULL AS billing_purchase_ready,
         to_regprocedure('hive.create_pending_purchase(uuid,text,uuid,text)') IS NOT NULL
           AS billing_function_ready,
         to_regprocedure('hive.apply_provider_payment_result(uuid,text,text,text,text)') IS NOT NULL
           AND to_regprocedure('hive.apply_provider_refund(uuid,text,text)') IS NOT NULL
           AND to_regprocedure('audit.capture_payment_transition()') IS NOT NULL
           AS billing_provider_ready,
         to_regclass('hive.payment_provider_events') IS NOT NULL
           AND to_regprocedure(
             'hive.apply_verified_payment_webhook(text,text,text,uuid,text,text,text,text)'
           ) IS NOT NULL AS billing_webhook_ready,
         (SELECT count(*)::integer
            FROM hive.product_entitlement_capabilities
           WHERE product_id = $2::uuid
             AND app_id = $1::uuid
             AND capability_code IN (
               'REFERENCE_APP_RUN_JOB',
               'REFERENCE_APP_GENERATE_FILE'
             )
             AND active) AS entitlement_mapping_count,
         to_regclass('hive.project_entitlements') IS NOT NULL
           AND to_regprocedure('hive.apply_entitlement_state_for_purchase(uuid)') IS NOT NULL
           AND to_regprocedure('hive.can_project_capability(uuid,text)') IS NOT NULL
           AS entitlements_ready,
         to_regclass('hive.usage_budgets') IS NOT NULL
           AND to_regclass('hive.usage_events') IS NOT NULL
           AND to_regclass('hive.cost_events') IS NOT NULL
           AND to_regprocedure(
             'hive.configure_usage_budget(uuid,text,text,text,numeric,text,timestamp with time zone,timestamp with time zone,text,jsonb)'
           ) IS NOT NULL
           AND to_regprocedure(
             'hive.record_usage_event(uuid,uuid,text,text,text,text,numeric,text,text,text,text,text,timestamp with time zone,jsonb)'
           ) IS NOT NULL
           AND to_regprocedure(
             'hive.record_cost_event(uuid,uuid,text,text,text,numeric,text,text,text,text,text,timestamp with time zone,jsonb)'
           ) IS NOT NULL AS usage_cost_ready,
         to_regclass('hive.cost_guard_decisions') IS NOT NULL
           AND to_regclass('hive.cost_guard_reservations') IS NOT NULL
           AND to_regprocedure(
             'hive.reserve_project_cost(uuid,uuid,text,text,numeric,text,jsonb)'
           ) IS NOT NULL
           AND to_regprocedure(
             'hive.consume_cost_reservation(uuid,numeric,text,text,text,timestamp with time zone,jsonb)'
           ) IS NOT NULL
           AND to_regprocedure(
             'hive.release_cost_reservation(uuid,jsonb)'
           ) IS NOT NULL AS cost_guard_ready,
         (SELECT count(*)::integer
            FROM hive.job_registrations
           WHERE app_id = $1::uuid
             AND job_type IN (
               'REFERENCE_APP_FAKE_AI_JOB',
               'REFERENCE_APP_RENDER_PROJECT_DOCUMENT'
             )
             AND active) AS reference_job_registration_count,
         to_regclass('hive.jobs') IS NOT NULL
           AND to_regclass('hive.job_registrations') IS NOT NULL
           AND to_regprocedure(
             'hive.enqueue_project_job(uuid,text,text,text,text,integer)'
           ) IS NOT NULL AS jobs_ready,
         to_regprocedure('hive.claim_next_job(text,integer)') IS NOT NULL
           AND to_regprocedure('hive.heartbeat_job(uuid,text,text,integer)') IS NOT NULL
           AND to_regprocedure('hive.complete_job(uuid,text,text,text,text)') IS NOT NULL
           AND to_regprocedure('hive.fail_job(uuid,text,text,text,text)') IS NOT NULL
           AND to_regprocedure('hive.recover_expired_job_leases(integer)') IS NOT NULL
           AS workers_ready,
         to_regclass('hive.ai_operations') IS NOT NULL
           AND to_regprocedure(
             'hive.start_ai_operation(uuid,text,text,text,text,text,text,text,text,text,text,text,numeric,text)'
           ) IS NOT NULL
           AND to_regprocedure(
             'hive.complete_ai_operation(text,text,integer,integer,numeric)'
           ) IS NOT NULL
           AND to_regprocedure('hive.fail_ai_operation(text,text)') IS NOT NULL
           AND to_regprocedure('audit.capture_ai_operation_transition()') IS NOT NULL
           AS ai_gateway_ready,
         to_regclass('hive.search_operations') IS NOT NULL
           AND to_regprocedure(
             'hive.start_search_operation(uuid,text,text,text,text,text,text,text,text,integer,text,text,numeric,text)'
           ) IS NOT NULL
           AND to_regprocedure(
             'hive.complete_search_operation(text,integer,integer,numeric,text)'
           ) IS NOT NULL
           AND to_regprocedure(
             'hive.complete_search_operation_accounted(text,uuid,integer,integer,numeric,text)'
           ) IS NOT NULL
           AND to_regprocedure('hive.fail_search_operation(text,text)') IS NOT NULL
           AND to_regprocedure(
             'hive.fail_search_operation_accounted(text,uuid,text)'
           ) IS NOT NULL
           AND to_regprocedure('audit.capture_search_operation_transition()') IS NOT NULL
           AS search_gateway_ready,
         to_regclass('hive.files') IS NOT NULL
           AND to_regprocedure(
             'hive.prepare_generated_file(uuid,text,text,text,text,bigint,text,text,text,text,text)'
           ) IS NOT NULL
           AND to_regprocedure('hive.complete_generated_file(uuid,text)') IS NOT NULL
           AND to_regprocedure('hive.abort_generated_file(uuid)') IS NOT NULL
           AND to_regprocedure('hive.soft_delete_file(uuid)') IS NOT NULL
           AS files_ready,
         to_regprocedure('hive.current_app_code()') IS NOT NULL AS app_helper_ready,
         to_regprocedure('hive.current_organization_id()') IS NOT NULL AS organization_helper_ready`,
      [
        '00000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000001',
        '50000000-0000-4000-8000-000000000001',
      ],
    );
    const state = result.rows[0];
    if (
      !state ||
      state.migration_count !== REFERENCE_APP_EXPECTED_MIGRATION_VERSION ||
      state.migration_version !== REFERENCE_APP_EXPECTED_MIGRATION_VERSION ||
      state.reference_app_count !== 1 ||
      state.reference_product_count !== 1 ||
      state.reference_price_count !== 1 ||
      !state.projects_ready ||
      !state.audit_ready ||
      !state.billing_catalog_ready ||
      !state.billing_purchase_ready ||
      !state.billing_function_ready ||
      !state.billing_provider_ready ||
      !state.billing_webhook_ready ||
      state.entitlement_mapping_count !== 2 ||
      !state.entitlements_ready ||
      !state.usage_cost_ready ||
      !state.cost_guard_ready ||
      state.reference_job_registration_count !== 2 ||
      !state.jobs_ready ||
      !state.workers_ready ||
      !state.ai_gateway_ready ||
      !state.search_gateway_ready ||
      !state.files_ready ||
      !state.app_helper_ready ||
      !state.organization_helper_ready
    ) {
      throw new Error('Green Hive database baseline is not ready');
    }
  };
}
