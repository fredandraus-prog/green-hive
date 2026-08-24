import assert from 'node:assert/strict';
import { loadMigrationCatalog } from './migration-catalog.mjs';
import { planPendingMigrations } from './migration-state.mjs';

export async function runGreenHiveDatabaseSmoke(client, repositoryRoot) {
  const catalog = await loadMigrationCatalog(repositoryRoot);
  const ledger = await client.query(
    `SELECT version, name, checksum_sha256, rollback_strategy
     FROM hive.schema_migrations
     ORDER BY version`,
  );
  assert.equal(ledger.rows.length, catalog.migrations.length);
  assert.equal(planPendingMigrations(catalog.migrations, ledger.rows).length, 0);

  const seed = await client.query(
    `SELECT id, app_code, app_version, status, schema_namespace
     FROM hive.apps
     WHERE app_code = 'REFERENCE_APP'`,
  );
  assert.deepEqual(seed.rows, [
    {
      id: '00000000-0000-4000-8000-000000000001',
      app_code: 'REFERENCE_APP',
      app_version: '0.1.0',
      status: 'INTERNAL',
      schema_namespace: 'reference_app',
    },
  ]);

  const billingSeed = await client.query(
    `SELECT
       product.id AS product_id,
       product.product_code,
       product.product_type,
       price.id AS price_id,
       price.version,
       price.amount::text AS amount,
       price.currency
     FROM hive.products AS product
     JOIN hive.prices AS price ON price.product_id = product.id AND price.app_id = product.app_id
     WHERE product.app_id = $1::uuid AND product.product_code = 'REFERENCE_APP_SANDBOX'`,
    ['00000000-0000-4000-8000-000000000001'],
  );
  assert.deepEqual(billingSeed.rows, [
    {
      product_id: '40000000-0000-4000-8000-000000000001',
      product_code: 'REFERENCE_APP_SANDBOX',
      product_type: 'ONE_TIME',
      price_id: '50000000-0000-4000-8000-000000000001',
      version: 1,
      amount: '0.000000',
      currency: 'BRL',
    },
  ]);

  const entitlementSeed = await client.query(
    `SELECT capability_code, active
     FROM hive.product_entitlement_capabilities
     WHERE product_id = $1::uuid
     ORDER BY capability_code`,
    ['40000000-0000-4000-8000-000000000001'],
  );
  assert.deepEqual(entitlementSeed.rows, [
    { capability_code: 'REFERENCE_APP_GENERATE_FILE', active: true },
    { capability_code: 'REFERENCE_APP_RUN_JOB', active: true },
  ]);

  const foreignKeys = await client.query(
    `SELECT conname, confrelid::regclass::text AS target
     FROM pg_constraint
     WHERE conname IN (
       'organization_members_user_fk',
       'organization_apps_installer_membership_fk',
       'audit_events_app_fk',
       'audit_events_organization_fk',
       'audit_events_project_scope_fk',
       'projects_owner_fk',
       'projects_organization_membership_fk',
       'projects_organization_app_fk',
       'project_settings_project_app_organization_fk'
       ,'products_app_fk'
       ,'prices_product_app_fk'
       ,'purchases_project_scope_fk'
       ,'purchases_product_app_fk'
       ,'purchases_price_product_app_fk'
       ,'payments_purchase_scope_fk'
       ,'payment_provider_events_purchase_fk'
       ,'payment_provider_events_payment_purchase_fk'
       ,'product_entitlement_capabilities_product_app_fk'
       ,'project_entitlements_project_scope_fk'
       ,'project_entitlements_purchase_source_fk'
       ,'project_entitlements_payment_purchase_fk'
       ,'project_entitlements_product_capability_fk'
       ,'usage_budgets_project_scope_fk'
       ,'usage_events_project_scope_fk'
       ,'usage_events_budget_scope_fk'
       ,'cost_events_project_scope_fk'
       ,'cost_events_budget_scope_fk'
     )
     ORDER BY conname`,
  );
  assert.deepEqual(foreignKeys.rows, [
    { conname: 'audit_events_app_fk', target: 'hive.apps' },
    { conname: 'audit_events_organization_fk', target: 'hive.organizations' },
    { conname: 'audit_events_project_scope_fk', target: 'hive.projects' },
    { conname: 'cost_events_budget_scope_fk', target: 'hive.usage_budgets' },
    { conname: 'cost_events_project_scope_fk', target: 'hive.projects' },
    { conname: 'organization_apps_installer_membership_fk', target: 'hive.organization_members' },
    { conname: 'organization_members_user_fk', target: 'auth.users' },
    { conname: 'payment_provider_events_payment_purchase_fk', target: 'hive.payments' },
    { conname: 'payment_provider_events_purchase_fk', target: 'hive.purchases' },
    { conname: 'payments_purchase_scope_fk', target: 'hive.purchases' },
    { conname: 'prices_product_app_fk', target: 'hive.products' },
    { conname: 'product_entitlement_capabilities_product_app_fk', target: 'hive.products' },
    { conname: 'products_app_fk', target: 'hive.apps' },
    { conname: 'project_entitlements_payment_purchase_fk', target: 'hive.payments' },
    { conname: 'project_entitlements_product_capability_fk', target: 'hive.product_entitlement_capabilities' },
    { conname: 'project_entitlements_project_scope_fk', target: 'hive.projects' },
    { conname: 'project_entitlements_purchase_source_fk', target: 'hive.purchases' },
    { conname: 'project_settings_project_app_organization_fk', target: 'hive.projects' },
    { conname: 'projects_organization_app_fk', target: 'hive.organization_apps' },
    { conname: 'projects_organization_membership_fk', target: 'hive.organization_members' },
    { conname: 'projects_owner_fk', target: 'auth.users' },
    { conname: 'purchases_price_product_app_fk', target: 'hive.prices' },
    { conname: 'purchases_product_app_fk', target: 'hive.products' },
    { conname: 'purchases_project_scope_fk', target: 'hive.projects' },
    { conname: 'usage_budgets_project_scope_fk', target: 'hive.projects' },
    { conname: 'usage_events_budget_scope_fk', target: 'hive.usage_budgets' },
    { conname: 'usage_events_project_scope_fk', target: 'hive.projects' },
  ]);

  const rls = await client.query(
    `SELECT pg_namespace.nspname AS schema_name, relname, relrowsecurity
     FROM pg_class
     JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
     WHERE (pg_namespace.nspname = 'hive'
       AND relname IN (
         'apps',
         'user_profiles',
         'organizations',
         'organization_members',
         'organization_apps',
         'organization_app_members',
         'projects',
         'project_settings',
         'products',
         'prices',
         'purchases',
         'payments'
         ,'payment_provider_events'
         ,'product_entitlement_capabilities'
         ,'project_entitlements'
         ,'usage_budgets'
         ,'usage_events'
         ,'cost_events'
       ))
       OR (pg_namespace.nspname = 'audit' AND relname = 'events')
     ORDER BY schema_name, relname`,
  );
  assert.equal(rls.rows.length, 19);
  assert.ok(rls.rows.every((entry) => entry.relrowsecurity));

  const helpers = await client.query(
    `SELECT to_regprocedure(name)::text AS helper
     FROM unnest(ARRAY[
       'hive.current_app_code()',
       'hive.current_app_id()',
       'hive.is_platform_admin()',
       'hive.has_trusted_app_context()',
       'hive.requested_organization_id()',
       'hive.current_organization_id()',
       'hive.has_organization_role(uuid,text[])',
       'hive.has_trusted_organization_context()',
       'hive.ensure_personal_organization(text)',
       'hive.create_shared_organization(text)',
       'hive.can_access_project(uuid,uuid,uuid)',
       'hive.soft_delete_project(uuid)'
       ,'audit.context_uuid(text)'
       ,'audit.append_core_event(text,uuid,uuid,uuid,text,uuid,jsonb)'
       ,'audit.capture_organization_created()'
       ,'audit.capture_organization_member_change()'
       ,'audit.capture_organization_app_installed()'
       ,'audit.capture_project_lifecycle()'
       ,'hive.create_pending_purchase(uuid,text,uuid,text)'
       ,'audit.capture_purchase_created()'
       ,'hive.apply_provider_payment_result(uuid,text,text,text,text)'
       ,'hive.apply_provider_refund(uuid,text,text)'
       ,'audit.capture_payment_transition()'
       ,'hive.apply_verified_payment_webhook(text,text,text,uuid,text,text,text,text)'
       ,'hive.apply_entitlement_state_for_purchase(uuid)'
       ,'hive.sync_entitlements_after_billing_transition()'
       ,'hive.can_project_capability(uuid,text)'
       ,'audit.capture_entitlement_transition()'
       ,'hive.configure_usage_budget(uuid,text,text,text,numeric,text,timestamp with time zone,timestamp with time zone,text,jsonb)'
       ,'hive.record_usage_event(uuid,uuid,text,text,text,text,numeric,text,text,text,text,text,timestamp with time zone,jsonb)'
       ,'hive.record_cost_event(uuid,uuid,text,text,text,numeric,text,text,text,text,text,timestamp with time zone,jsonb)'
       ,'audit.capture_usage_budget_configured()'
     ]) AS names(name)`,
  );
  assert.equal(helpers.rows.length, 32);
  assert.ok(helpers.rows.every((entry) => entry.helper));

  const privileges = await client.query(
    `SELECT
       has_table_privilege('authenticated', 'hive.projects', 'SELECT') AS can_select,
       has_table_privilege('authenticated', 'hive.projects', 'INSERT') AS can_insert,
       has_table_privilege('authenticated', 'hive.projects', 'UPDATE') AS can_update,
       has_table_privilege('authenticated', 'hive.projects', 'DELETE') AS can_delete`,
  );
  assert.deepEqual(privileges.rows[0], {
    can_select: true,
    can_insert: true,
    can_update: true,
    can_delete: false,
  });

  const auditPrivileges = await client.query(
    `SELECT
       has_table_privilege('authenticated', 'audit.events', 'SELECT') AS can_select,
       has_table_privilege('authenticated', 'audit.events', 'INSERT') AS can_insert,
       has_table_privilege('authenticated', 'audit.events', 'UPDATE') AS can_update,
       has_table_privilege('authenticated', 'audit.events', 'DELETE') AS can_delete`,
  );
  assert.deepEqual(auditPrivileges.rows[0], {
    can_select: true,
    can_insert: false,
    can_update: false,
    can_delete: false,
  });

  const billingPrivileges = await client.query(
    `SELECT
       has_table_privilege('authenticated', 'hive.products', 'SELECT') AS catalog_select,
       has_table_privilege('authenticated', 'hive.products', 'INSERT') AS catalog_insert,
       has_table_privilege('authenticated', 'hive.purchases', 'INSERT') AS purchase_insert,
       has_table_privilege('authenticated', 'hive.payments', 'UPDATE') AS payment_update,
       has_column_privilege('authenticated', 'hive.purchases', 'amount', 'SELECT') AS purchase_amount_select,
       has_column_privilege('authenticated', 'hive.purchases', 'idempotency_key_sha256', 'SELECT') AS idempotency_select,
       has_column_privilege('authenticated', 'hive.payments', 'status', 'SELECT') AS payment_status_select,
       has_column_privilege('authenticated', 'hive.payments', 'provider_payment_id', 'SELECT') AS provider_reference_select,
       has_column_privilege('authenticated', 'hive.payments', 'provider_refund_id', 'SELECT') AS provider_refund_select,
       has_column_privilege('authenticated', 'hive.payments', 'refunded_amount', 'SELECT') AS refunded_amount_select,
       has_table_privilege(
         'authenticated',
         'hive.payment_provider_events',
         'SELECT'
       ) AS provider_event_select,
       has_function_privilege(
         'authenticated',
         'hive.create_pending_purchase(uuid,text,uuid,text)',
         'EXECUTE'
       ) AS can_create_pending_purchase,
       has_function_privilege(
         'authenticated',
         'hive.apply_provider_payment_result(uuid,text,text,text,text)',
         'EXECUTE'
       ) AS authenticated_can_apply_payment,
       has_function_privilege(
         'authenticated',
         'hive.apply_provider_refund(uuid,text,text)',
         'EXECUTE'
       ) AS authenticated_can_apply_refund,
       has_function_privilege(
         'service_role',
         'hive.apply_provider_payment_result(uuid,text,text,text,text)',
         'EXECUTE'
       ) AS service_role_can_apply_payment,
       has_function_privilege(
         'service_role',
         'hive.apply_provider_refund(uuid,text,text)',
         'EXECUTE'
       ) AS service_role_can_apply_refund,
       has_function_privilege(
         'authenticated',
         'hive.apply_verified_payment_webhook(text,text,text,uuid,text,text,text,text)',
         'EXECUTE'
       ) AS authenticated_can_apply_webhook,
       has_function_privilege(
         'service_role',
         'hive.apply_verified_payment_webhook(text,text,text,uuid,text,text,text,text)',
         'EXECUTE'
       ) AS service_role_can_apply_webhook`,
  );
  assert.deepEqual(billingPrivileges.rows[0], {
    catalog_select: true,
    catalog_insert: false,
    purchase_insert: false,
    payment_update: false,
    purchase_amount_select: true,
    idempotency_select: false,
    payment_status_select: true,
    provider_reference_select: false,
    provider_refund_select: false,
    refunded_amount_select: true,
    provider_event_select: false,
    can_create_pending_purchase: true,
    authenticated_can_apply_payment: false,
    authenticated_can_apply_refund: false,
    service_role_can_apply_payment: true,
    service_role_can_apply_refund: true,
    authenticated_can_apply_webhook: false,
    service_role_can_apply_webhook: true,
  });

  const entitlementPrivileges = await client.query(
    `SELECT
       has_table_privilege(
         'authenticated',
         'hive.product_entitlement_capabilities',
         'SELECT'
       ) AS mapping_select,
       has_table_privilege(
         'authenticated',
         'hive.project_entitlements',
         'SELECT'
       ) AS entitlement_select,
       has_any_column_privilege(
         'authenticated',
         'hive.project_entitlements',
         'SELECT'
       ) AS entitlement_column_select,
       has_table_privilege(
         'authenticated',
         'hive.project_entitlements',
         'INSERT'
       ) AS entitlement_insert,
       has_table_privilege(
         'authenticated',
         'hive.project_entitlements',
         'UPDATE'
       ) AS entitlement_update,
       has_table_privilege(
         'authenticated',
         'hive.project_entitlements',
         'DELETE'
       ) AS entitlement_delete,
       has_function_privilege(
         'authenticated',
         'hive.can_project_capability(uuid,text)',
         'EXECUTE'
       ) AS authenticated_can_decide,
       has_function_privilege(
         'authenticated',
         'hive.apply_entitlement_state_for_purchase(uuid)',
         'EXECUTE'
       ) AS authenticated_can_apply,
       has_function_privilege(
         'service_role',
         'hive.apply_entitlement_state_for_purchase(uuid)',
         'EXECUTE'
       ) AS service_role_can_apply`,
  );
  assert.deepEqual(entitlementPrivileges.rows[0], {
    mapping_select: true,
    entitlement_select: false,
    entitlement_column_select: true,
    entitlement_insert: false,
    entitlement_update: false,
    entitlement_delete: false,
    authenticated_can_decide: true,
    authenticated_can_apply: false,
    service_role_can_apply: true,
  });

  const usageCostPrivileges = await client.query(
    `SELECT
       has_table_privilege('authenticated', 'hive.usage_budgets', 'SELECT')
         AS budget_table_select,
       has_any_column_privilege('authenticated', 'hive.usage_budgets', 'SELECT')
         AS budget_column_select,
       has_table_privilege('authenticated', 'hive.usage_events', 'SELECT')
         AS usage_table_select,
       has_any_column_privilege('authenticated', 'hive.usage_events', 'SELECT')
         AS usage_column_select,
       has_table_privilege('authenticated', 'hive.cost_events', 'SELECT')
         AS cost_table_select,
       has_any_column_privilege('authenticated', 'hive.cost_events', 'SELECT')
         AS cost_column_select,
       has_table_privilege('authenticated', 'hive.usage_budgets', 'INSERT')
         AS budget_insert,
       has_table_privilege('authenticated', 'hive.usage_events', 'INSERT')
         AS usage_insert,
       has_table_privilege('authenticated', 'hive.cost_events', 'INSERT')
         AS cost_insert,
       has_function_privilege(
         'authenticated',
         'hive.configure_usage_budget(uuid,text,text,text,numeric,text,timestamp with time zone,timestamp with time zone,text,jsonb)',
         'EXECUTE'
       ) AS authenticated_can_configure,
       has_function_privilege(
         'service_role',
         'hive.configure_usage_budget(uuid,text,text,text,numeric,text,timestamp with time zone,timestamp with time zone,text,jsonb)',
         'EXECUTE'
       ) AS service_role_can_configure,
       has_function_privilege(
         'authenticated',
         'hive.record_usage_event(uuid,uuid,text,text,text,text,numeric,text,text,text,text,text,timestamp with time zone,jsonb)',
         'EXECUTE'
       ) AS authenticated_can_record_usage,
       has_function_privilege(
         'service_role',
         'hive.record_usage_event(uuid,uuid,text,text,text,text,numeric,text,text,text,text,text,timestamp with time zone,jsonb)',
         'EXECUTE'
       ) AS service_role_can_record_usage,
       has_function_privilege(
         'authenticated',
         'hive.record_cost_event(uuid,uuid,text,text,text,numeric,text,text,text,text,text,timestamp with time zone,jsonb)',
         'EXECUTE'
       ) AS authenticated_can_record_cost,
       has_function_privilege(
         'service_role',
         'hive.record_cost_event(uuid,uuid,text,text,text,numeric,text,text,text,text,text,timestamp with time zone,jsonb)',
         'EXECUTE'
       ) AS service_role_can_record_cost`,
  );
  assert.deepEqual(usageCostPrivileges.rows[0], {
    budget_table_select: false,
    budget_column_select: true,
    usage_table_select: false,
    usage_column_select: true,
    cost_table_select: false,
    cost_column_select: true,
    budget_insert: false,
    usage_insert: false,
    cost_insert: false,
    authenticated_can_configure: false,
    service_role_can_configure: true,
    authenticated_can_record_usage: false,
    service_role_can_record_usage: true,
    authenticated_can_record_cost: false,
    service_role_can_record_cost: true,
  });

  const auditTriggers = await client.query(
    `SELECT tgname
     FROM pg_trigger
     WHERE tgname IN (
       'audit_organizations_after_insert',
       'audit_organization_members_after_change',
       'audit_organization_apps_after_insert',
       'audit_projects_after_lifecycle'
       ,'audit_purchases_after_insert'
       ,'audit_payments_after_transition'
       ,'entitlements_purchases_after_transition'
       ,'entitlements_payments_after_transition'
       ,'audit_project_entitlements_after_transition'
       ,'audit_usage_budgets_after_insert'
     )
       AND NOT tgisinternal
     ORDER BY tgname`,
  );
  assert.equal(auditTriggers.rows.length, 10);

  return Object.freeze({
    ledgerRows: ledger.rows.length,
    referenceApps: seed.rows.length,
    referenceProducts: billingSeed.rows.length,
    referenceEntitlementCapabilities: entitlementSeed.rows.length,
  });
}
