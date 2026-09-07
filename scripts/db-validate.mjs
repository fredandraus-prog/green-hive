import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadMigrationCatalog } from './lib/migration-catalog.mjs';

const thisFile = fileURLToPath(import.meta.url);
const defaultRepositoryRoot = path.resolve(path.dirname(thisFile), '..');

const requiredSchemas = ['hive', 'audit', 'reference_app'];
const requiredHiveTables = [
  'schema_migrations',
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
  'payments',
  'payment_provider_events',
  'product_entitlement_capabilities',
  'project_entitlements',
  'usage_budgets',
  'usage_events',
  'cost_events',
  'cost_guard_decisions',
  'cost_guard_reservations',
  'job_registrations',
  'jobs',
  'ai_operations',
  'search_operations',
  'files',
];
const requiredAuditTables = ['events'];
const forceRlsTables = [
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
  'payments',
  'payment_provider_events',
  'product_entitlement_capabilities',
  'project_entitlements',
  'usage_budgets',
  'usage_events',
  'cost_events',
  'cost_guard_decisions',
  'cost_guard_reservations',
  'job_registrations',
  'jobs',
  'ai_operations',
  'search_operations',
  'files',
];
const expectedPolicies = new Map([
  ['apps', ['apps_admin_select']],
  [
    'user_profiles',
    [
      'user_profiles_owner_select',
      'user_profiles_owner_insert',
      'user_profiles_owner_update',
    ],
  ],
  [
    'organizations',
    ['organizations_member_or_platform_select', 'organizations_admin_update'],
  ],
  [
    'organization_members',
    [
      'organization_members_member_or_platform_select',
      'organization_members_admin_insert',
      'organization_members_admin_update',
    ],
  ],
  [
    'organization_apps',
    [
      'organization_apps_member_or_platform_select',
      'organization_apps_admin_insert',
      'organization_apps_admin_update',
    ],
  ],
  [
    'organization_app_members',
    [
      'organization_app_members_member_or_platform_select',
      'organization_app_members_admin_insert',
      'organization_app_members_admin_update',
    ],
  ],
  [
    'projects',
    [
      'projects_tenant_owner_select',
      'projects_tenant_owner_insert',
      'projects_tenant_owner_update',
    ],
  ],
  [
    'project_settings',
    [
      'project_settings_tenant_owner_select',
      'project_settings_tenant_owner_insert',
      'project_settings_tenant_owner_update',
    ],
  ],
  ['products', ['products_catalog_select']],
  ['prices', ['prices_catalog_select']],
  ['purchases', ['purchases_owner_select']],
  ['payments', ['payments_owner_limited_select']],
  ['payment_provider_events', []],
  [
    'product_entitlement_capabilities',
    ['product_entitlement_capabilities_catalog_select'],
  ],
  ['project_entitlements', ['project_entitlements_owner_or_platform_select']],
  ['usage_budgets', ['usage_budgets_owner_or_platform_select']],
  ['usage_events', ['usage_events_owner_or_platform_select']],
  ['cost_events', ['cost_events_platform_select']],
  ['cost_guard_decisions', ['cost_guard_decisions_owner_or_platform_select']],
  ['cost_guard_reservations', ['cost_guard_reservations_owner_or_platform_select']],
  ['job_registrations', ['job_registrations_current_app_or_platform_select']],
  ['jobs', ['jobs_owner_or_platform_select']],
  ['ai_operations', ['ai_operations_owner_or_platform_select']],
  ['search_operations', ['search_operations_owner_or_platform_select']],
  ['files', ['files_owner_select']],
]);
const forbiddenHiveDomainTerms = [
  'break_even',
  'viability',
  'customer_segment',
  'business_risk',
  'supplier_concentration',
];

function normalizeSql(sql) {
  return sql.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim();
}

function collectCreatedTables(migrations) {
  const created = new Map();
  const expression = /CREATE\s+TABLE\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)/gi;
  for (const migration of migrations) {
    let match;
    while ((match = expression.exec(migration.sql)) !== null) {
      created.set(`${match[1]}.${match[2]}`, migration.version);
    }
  }
  return created;
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableJson(nested)]),
    );
  }
  return value;
}

export async function validateDatabaseLayout(repositoryRoot = defaultRepositoryRoot) {
  const errors = [];
  let catalog;

  try {
    catalog = await loadMigrationCatalog(repositoryRoot);
  } catch (error) {
    return [`Unable to load migration catalog: ${error.message}`];
  }

  if (catalog.formatVersion !== 1) errors.push('migrations.json formatVersion must be 1');
  if (catalog.algorithm !== 'sha256') errors.push('migrations.json algorithm must be sha256');
  if (!Array.isArray(catalog.migrations) || catalog.migrations.length < 11) {
    errors.push('Green Hive must retain migrations 0001 through 0011 or later');
    return errors;
  }

  const catalogFiles = catalog.migrations.map((entry) => entry.file).sort();
  if (JSON.stringify(catalogFiles) !== JSON.stringify(catalog.sqlFiles)) {
    errors.push('catalog SQL files do not exactly match database/migrations/*.sql');
  }

  const seenVersions = new Set();
  const seenFiles = new Set();
  for (const [index, migration] of catalog.migrations.entries()) {
    const expectedVersion = index + 1;
    const expectedId = String(expectedVersion).padStart(4, '0');
    const expectedPrefix = `${expectedId}_`;

    if (migration.version !== expectedVersion) {
      errors.push(`migration at catalog index ${index} must use version ${expectedVersion}`);
    }
    if (!migration.file.startsWith(expectedPrefix) || !migration.file.endsWith('.sql')) {
      errors.push(`${migration.file} must start with ${expectedPrefix} and end with .sql`);
    }
    if (seenVersions.has(migration.version)) errors.push(`duplicate migration version ${migration.version}`);
    if (seenFiles.has(migration.file)) errors.push(`duplicate migration file ${migration.file}`);
    seenVersions.add(migration.version);
    seenFiles.add(migration.file);

    if (!/^[0-9a-f]{64}$/.test(migration.sha256)) {
      errors.push(`${migration.file} has an invalid SHA-256 value`);
    } else if (migration.sha256 !== migration.actualSha256) {
      errors.push(`${migration.file} checksum differs from migrations.json`);
    }
    if (typeof migration.description !== 'string' || migration.description.trim().length < 12) {
      errors.push(`${migration.file} must include a meaningful description`);
    }
    if (
      typeof migration.rollbackStrategy !== 'string' ||
      migration.rollbackStrategy.trim().length < 24
    ) {
      errors.push(`${migration.file} must document a rollback strategy`);
    }
    if (migration.metadata.migrationId !== expectedId) {
      errors.push(`${migration.file} header migration id must be ${expectedId}`);
    }
    if (!migration.metadata.checkpoint?.startsWith('GH-')) {
      errors.push(`${migration.file} header must identify its GH checkpoint`);
    }
    if (migration.metadata.description !== migration.description) {
      errors.push(`${migration.file} header description differs from migrations.json`);
    }
    if (migration.metadata.rollbackStrategyCode !== migration.rollbackStrategyCode) {
      errors.push(`${migration.file} rollback strategy code differs from migrations.json`);
    }

    const withoutAllowedExtension = migration.sql.replace(
      /CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+pgcrypto\s*;/gi,
      '',
    );
    if (/\bIF\s+NOT\s+EXISTS\b/i.test(withoutAllowedExtension)) {
      errors.push(`${migration.file} hides managed-object drift with IF NOT EXISTS`);
    }
    if (/\bCREATE\s+OR\s+REPLACE\b/i.test(migration.sql)) {
      errors.push(`${migration.file} mutates an existing object with CREATE OR REPLACE`);
    }
  }

  const allSql = catalog.migrations.map((migration) => migration.sql).join('\n');
  const normalizedAllSql = normalizeSql(allSql);
  const firstSql = normalizeSql(catalog.migrations[0]?.sql ?? '');

  for (const schema of requiredSchemas) {
    if (!new RegExp(`CREATE\\s+SCHEMA\\s+${schema}\\b`, 'i').test(firstSql)) {
      errors.push(`0001 must create the ${schema} schema`);
    }
  }
  if (!/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+pgcrypto/i.test(firstSql)) {
    errors.push('0001 must provision pgcrypto as the only idempotent shared extension');
  }

  const createdTables = collectCreatedTables(catalog.migrations);
  for (const table of requiredHiveTables) {
    if (!createdTables.has(`hive.${table}`)) errors.push(`missing required table hive.${table}`);
  }
  for (const table of requiredAuditTables) {
    if (!createdTables.has(`audit.${table}`)) errors.push(`missing required table audit.${table}`);
  }
  for (const [table, version] of createdTables.entries()) {
    const [schema, name] = table.split('.');
    if (schema === 'hive' && !requiredHiveTables.includes(name)) {
      errors.push(`unexpected domain table ${table} in the hive schema at migration ${version}`);
    }
  }

  const externalReferences = new Set(['auth.users']);
  const referenceExpression = /REFERENCES\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)/gi;
  for (const migration of catalog.migrations) {
    let match;
    while ((match = referenceExpression.exec(migration.sql)) !== null) {
      const target = `${match[1]}.${match[2]}`;
      const createdAt = createdTables.get(target);
      if (createdAt === undefined && !externalReferences.has(target)) {
        errors.push(`${migration.file} references missing table ${target}`);
      } else if (createdAt !== undefined && createdAt > migration.version) {
        errors.push(`${migration.file} references future table ${target}`);
      }
    }
  }

  for (const [table, policies] of expectedPolicies.entries()) {
    if (!new RegExp(`ALTER TABLE hive\\.${table} ENABLE ROW LEVEL SECURITY`, 'i').test(normalizedAllSql)) {
      errors.push(`RLS is not enabled on hive.${table}`);
    }
    if (
      forceRlsTables.includes(table) &&
      !new RegExp(`ALTER TABLE hive\\.${table} FORCE ROW LEVEL SECURITY`, 'i').test(normalizedAllSql)
    ) {
      errors.push(`RLS is not forced on hive.${table}`);
    }
    for (const policy of policies) {
      if (!new RegExp(`CREATE POLICY ${policy}\\b`, 'i').test(normalizedAllSql)) {
        errors.push(`hive.${table} lacks required policy ${policy}`);
      }
    }
    if (new RegExp(`CREATE POLICY [a-z0-9_]+ ON hive\\.${table} FOR DELETE\\b`, 'i').test(normalizedAllSql)) {
      errors.push(`hive.${table} must not expose physical DELETE through RLS`);
    }
  }

  if (!/ALTER TABLE audit\.events ENABLE ROW LEVEL SECURITY/i.test(normalizedAllSql)) {
    errors.push('RLS is not enabled on audit.events');
  }
  if (!/ALTER TABLE audit\.events FORCE ROW LEVEL SECURITY/i.test(normalizedAllSql)) {
    errors.push('RLS is not forced on audit.events');
  }
  if (!/CREATE POLICY audit_events_tenant_or_platform_select\b/i.test(normalizedAllSql)) {
    errors.push('audit.events lacks its tenant/platform read policy');
  }
  if (/CREATE POLICY [a-z0-9_]+ ON audit\.events FOR (INSERT|UPDATE|DELETE)\b/i.test(normalizedAllSql)) {
    errors.push('audit.events must remain append-only without authenticated write policies');
  }
  if (/GRANT\s+[\s\S]{0,120}\b(INSERT|UPDATE|DELETE)\b[\s\S]{0,120}ON\s+audit\.events[\s\S]{0,80}TO\s+authenticated\b/i.test(allSql)) {
    errors.push('authenticated must not receive direct write privileges on audit.events');
  }

  const requiredContextMarkers = [
    'auth.uid()',
    'auth.jwt()',
    '{app_metadata,app_code}',
    '{app_metadata,platform_role}',
    'hive.current_app_code()',
    'hive.current_app_id()',
    'hive.has_trusted_app_context()',
    'hive.requested_organization_id()',
    'hive.current_organization_id()',
    'hive.has_trusted_organization_context()',
    'hive.ensure_personal_organization',
    'hive.create_shared_organization',
    'hive.soft_delete_project',
    'request.green_hive.request_id',
    'request.green_hive.correlation_id',
    'audit.append_core_event',
    'audit.capture_organization_created',
    'audit.capture_organization_member_change',
    'audit.capture_organization_app_installed',
    'audit.capture_project_lifecycle',
    'hive.create_pending_purchase',
    'audit.capture_purchase_created',
    'audit_purchases_after_insert',
    'hive.apply_provider_payment_result',
    'hive.apply_provider_refund',
    'audit.capture_payment_transition',
    'audit_payments_after_transition',
    'hive.apply_verified_payment_webhook',
    'payment_provider_events',
    'PAYMENT_FAILED',
    'hive.apply_entitlement_state_for_purchase',
    'hive.sync_entitlements_after_billing_transition',
    'hive.can_project_capability',
    'audit.capture_entitlement_transition',
    'audit_project_entitlements_after_transition',
    'ENTITLEMENT_GRANTED',
    'ENTITLEMENT_CHANGED',
    'hive.configure_usage_budget',
    'hive.record_usage_event',
    'hive.record_cost_event',
    'audit.capture_usage_budget_configured',
    'audit_usage_budgets_after_insert',
    'USAGE_BUDGET_CONFIGURED',
    'hive.reserve_project_cost',
    'hive.consume_cost_reservation',
    'hive.release_cost_reservation',
    'audit.capture_cost_guard_decision',
    'audit_cost_guard_decisions_after_insert',
    'COST_GUARD_DECIDED',
    'hive.enqueue_project_job',
    'audit.capture_job_queued',
    'audit_jobs_after_insert',
    'JOB_QUEUED',
    'hive.job_retry_delay_seconds',
    'hive.claim_next_job',
    'hive.heartbeat_job',
    'hive.complete_job',
    'hive.fail_job',
    'hive.cancel_job',
    'hive.recover_expired_job_leases',
    'audit.capture_job_transition',
    'audit_jobs_after_transition',
    'JOB_STARTED',
    'JOB_RETRY_SCHEDULED',
    'JOB_COMPLETED',
    'JOB_CANCELLED',
    'hive.start_search_operation',
    'hive.complete_search_operation',
    'hive.fail_search_operation',
    'audit.capture_search_operation_transition',
    'audit_search_operations_after_transition',
    'SEARCH_OPERATION_COMPLETED',
    'SEARCH_OPERATION_FAILED',
  ];
  for (const marker of requiredContextMarkers) {
    if (!allSql.includes(marker)) errors.push(`trusted app context is missing marker: ${marker}`);
  }
  if (/request\.jwt\.claims/i.test(allSql)) {
    errors.push('migrations must use Supabase auth.jwt() rather than parsing JWT GUCs directly');
  }
  if (/user_metadata/i.test(allSql)) {
    errors.push('RLS must not trust user-editable user_metadata claims');
  }
  for (const removedPolicy of [
    'user_profiles_admin_select',
    'projects_admin_select',
    'project_settings_admin_select',
  ]) {
    if (!new RegExp(`DROP POLICY ${removedPolicy}\\b`, 'i').test(normalizedAllSql)) {
      errors.push(`tenant privacy migration must remove legacy policy ${removedPolicy}`);
    }
  }
  if (/GRANT\s+[\s\S]{0,100}\bDELETE\b[\s\S]{0,100}\bTO\s+authenticated\b/i.test(allSql)) {
    errors.push('authenticated must not receive physical DELETE privileges');
  }
  for (const billingTable of [
    'products',
    'prices',
    'purchases',
    'payments',
    'payment_provider_events',
    'product_entitlement_capabilities',
    'project_entitlements',
    'usage_budgets',
    'usage_events',
    'cost_events',
    'cost_guard_decisions',
    'cost_guard_reservations',
    'job_registrations',
    'jobs',
    'search_operations',
  ]) {
    if (new RegExp(`GRANT\\s+[\\s\\S]{0,120}\\b(INSERT|UPDATE|DELETE)\\b[\\s\\S]{0,120}ON\\s+hive\\.${billingTable}\\b[\\s\\S]{0,80}TO\\s+authenticated\\b`, 'i').test(allSql)) {
      errors.push(`authenticated must not receive direct write privileges on hive.${billingTable}`);
    }
  }
  for (const billingMarker of [
    "product_type IN ('ONE_TIME', 'REANALYSIS_OR_REPROCESS', 'SUBSCRIPTION', 'INTERNAL_GRANT')",
    'amount numeric(20, 6)',
    'idempotency_key_sha256 text',
    "status IN ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'DISPUTED')",
    'SECURITY DEFINER',
    "SET search_path = ''",
    'REVOKE ALL ON FUNCTION hive.create_pending_purchase(uuid, text, uuid, text) FROM PUBLIC',
    'provider_refund_id text',
    'refunded_amount numeric(20, 6)',
    'payload_sha256 text',
    "event_type IN ('PAYMENT_PAID', 'PAYMENT_FAILED', 'PAYMENT_REFUNDED')",
  ]) {
    if (!allSql.includes(billingMarker)) errors.push(`billing contract is missing marker: ${billingMarker}`);
  }
  for (const protectedFunction of [
    'hive.apply_provider_payment_result\\(uuid, text, text, text, text\\)',
    'hive.apply_provider_refund\\(uuid, text, text\\)',
    'hive.apply_verified_payment_webhook\\(\\s*text,\\s*text,\\s*text,\\s*uuid,\\s*text,\\s*text,\\s*text,\\s*text\\s*\\)',
    'hive.apply_entitlement_state_for_purchase\\(uuid\\)',
    'hive.configure_usage_budget\\(\\s*uuid,\\s*text,\\s*text,\\s*text,\\s*numeric,\\s*text,\\s*timestamptz,\\s*timestamptz,\\s*text,\\s*jsonb\\s*\\)',
    'hive.record_usage_event\\(\\s*uuid,\\s*uuid,\\s*text,\\s*text,\\s*text,\\s*text,\\s*numeric,\\s*text,\\s*text,\\s*text,\\s*text,\\s*text,\\s*timestamptz,\\s*jsonb\\s*\\)',
    'hive.record_cost_event\\(\\s*uuid,\\s*uuid,\\s*text,\\s*text,\\s*text,\\s*numeric,\\s*text,\\s*text,\\s*text,\\s*text,\\s*text,\\s*timestamptz,\\s*jsonb\\s*\\)',
    'hive.reserve_project_cost\\(\\s*uuid,\\s*uuid,\\s*text,\\s*text,\\s*numeric,\\s*text,\\s*jsonb\\s*\\)',
    'hive.consume_cost_reservation\\(\\s*uuid,\\s*numeric,\\s*text,\\s*text,\\s*text,\\s*timestamptz,\\s*jsonb\\s*\\)',
    'hive.release_cost_reservation\\(\\s*uuid,\\s*jsonb\\s*\\)',
    'hive.enqueue_project_job\\(\\s*uuid,\\s*text,\\s*text,\\s*text,\\s*text,\\s*integer\\s*\\)',
  ]) {
    const revokePattern = new RegExp(
      `REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+${protectedFunction}\\s+FROM\\s+(PUBLIC|authenticated)`,
      'i',
    );
    if (!revokePattern.test(allSql)) {
      errors.push(`trusted payment function is not protected: ${protectedFunction}`);
    }
  }
  if (/\b(card_number|cardholder|cvv|cvc|full_card)\b\s+(text|varchar|character|jsonb?|bytea)\b/i.test(allSql)) {
    errors.push('payment-card data leaked into Green Hive migrations');
  }
  if (/payment_provider_events[\s\S]{0,2400}\b(raw_payload|raw_body|signature)\b\s+(text|jsonb?|bytea)\b/i.test(allSql)) {
    errors.push('verified webhook storage must not retain raw payloads or provider signatures');
  }
  for (const entitlementMarker of [
    'CREATE TABLE hive.product_entitlement_capabilities',
    'CREATE TABLE hive.project_entitlements',
    "status IN ('ACTIVE', 'REVOKED')",
    "source_type = 'PURCHASE'",
    'UNIQUE (purchase_id, capability_code)',
    'GRANT EXECUTE ON FUNCTION hive.can_project_capability(uuid, text) TO authenticated',
    'REVOKE ALL ON FUNCTION hive.apply_entitlement_state_for_purchase(uuid) FROM authenticated',
  ]) {
    if (!allSql.includes(entitlementMarker)) {
      errors.push(`entitlement contract is missing marker: ${entitlementMarker}`);
    }
  }
  for (const usageCostMarker of [
    'CREATE TABLE hive.usage_budgets',
    'CREATE TABLE hive.usage_events',
    'CREATE TABLE hive.cost_events',
    "budget_type IN (",
    "measurement_kind IN ('USAGE', 'COST')",
    'ceiling_amount numeric(24, 8)',
    'quantity numeric(24, 8)',
    'amount numeric(24, 8)',
    "event_kind IN ('DEBIT', 'CREDIT')",
    'usage_budgets_project_scope_fk',
    'usage_events_project_scope_fk',
    'cost_events_project_scope_fk',
    'USAGE_COST_IDEMPOTENCY_CONFLICT',
    'REVOKE ALL ON FUNCTION hive.configure_usage_budget(',
    'REVOKE ALL ON FUNCTION hive.record_usage_event(',
    'REVOKE ALL ON FUNCTION hive.record_cost_event(',
    'Reservation and consumption decisions remain GH-0402',
  ]) {
    if (!allSql.includes(usageCostMarker)) {
      errors.push(`usage/cost foundation is missing marker: ${usageCostMarker}`);
    }
  }
  for (const costGuardMarker of [
    'CREATE TABLE hive.cost_guard_decisions',
    'CREATE TABLE hive.cost_guard_reservations',
    "decision IN (",
    "status IN ('RESERVED', 'CONSUMED', 'RELEASED')",
    'cost_guard_decisions_operation_unique',
    'cost_guard_reservations_operation_unique',
    'FOR UPDATE',
    'COST_GUARD_IDEMPOTENCY_CONFLICT',
    'COST_GUARD_INVALID_TRANSITION',
    "selected_decision := 'DENY_ENTITLEMENT'",
    "selected_decision := 'DENY_BUDGET'",
    'created_cost_event_id := hive.record_cost_event',
    'REVOKE ALL ON FUNCTION hive.reserve_project_cost(',
    'REVOKE ALL ON FUNCTION hive.consume_cost_reservation(',
    'REVOKE ALL ON FUNCTION hive.release_cost_reservation(',
  ]) {
    if (!allSql.includes(costGuardMarker)) {
      errors.push(`atomic Cost Guard contract is missing marker: ${costGuardMarker}`);
    }
  }
  for (const jobsMarker of [
    'CREATE TABLE hive.job_registrations',
    'CREATE TABLE hive.jobs',
    "status IN ('QUEUED', 'RUNNING', 'RETRYING', 'COMPLETED', 'FAILED', 'CANCELLED')",
    'jobs_idempotency_unique',
    'idempotency_key_sha256 text',
    'request_fingerprint_sha256 text',
    'JOB_IDEMPOTENCY_CONFLICT',
    'JOB_ENTITLEMENT_REQUIRED',
    'selected_registration.required_capability',
    'REVOKE ALL ON FUNCTION hive.enqueue_project_job(',
    'Raw payloads remain outside the queue',
    'Worker claim and lifecycle transitions remain GH-0404',
  ]) {
    if (!allSql.includes(jobsMarker)) {
      errors.push(`Jobs foundation is missing marker: ${jobsMarker}`);
    }
  }
  for (const workerMarker of [
    'ADD COLUMN leased_by text',
    'ADD COLUMN lease_token_sha256 text',
    'ADD COLUMN lease_expires_at timestamptz',
    'ADD COLUMN heartbeat_at timestamptz',
    'FOR UPDATE SKIP LOCKED',
    "target_failure_kind NOT IN ('TRANSIENT', 'PERMANENT')",
    "target_retry_policy = 'FIXED' THEN RETURN 30",
    'LEAST(3600, (5 * power(2::numeric, target_attempt_count - 1))::integer)',
    "RAISE EXCEPTION 'WORKER_LEASE_LOST'",
    'GRANT EXECUTE ON FUNCTION hive.claim_next_job(text, integer) TO service_role',
  ]) {
    if (!allSql.includes(workerMarker)) {
      errors.push(`Worker lifecycle is missing marker: ${workerMarker}`);
    }
  }
  for (const workerFunction of [
    'hive.claim_next_job\\(text,\\s*integer\\)',
    'hive.heartbeat_job\\(uuid,\\s*text,\\s*text,\\s*integer\\)',
    'hive.complete_job\\(uuid,\\s*text,\\s*text,\\s*text,\\s*text\\)',
    'hive.fail_job\\(uuid,\\s*text,\\s*text,\\s*text,\\s*text\\)',
    'hive.cancel_job\\(uuid,\\s*text,\\s*text\\)',
    'hive.recover_expired_job_leases\\(integer\\)',
  ]) {
    for (const deniedRole of ['PUBLIC', 'authenticated']) {
      if (!new RegExp(
        `REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+${workerFunction}\\s+FROM\\s+${deniedRole}`,
        'i',
      ).test(allSql)) {
        errors.push(`Worker function ${workerFunction} must be revoked from ${deniedRole}`);
      }
    }
  }
  if (/GRANT\s+SELECT\s*\([\s\S]{0,800}\b(leased_by|lease_token_sha256|output_sha256|output_reference)\b[\s\S]{0,200}ON\s+hive\.jobs\s+TO\s+authenticated/i.test(allSql)) {
    errors.push('authenticated must not receive Worker lease or output columns');
  }
  for (const searchMarker of [
    'CREATE TABLE hive.search_operations',
    'search_operations_project_scope_fk',
    'search_operations_scope_operation_unique',
    "cache_status IN ('NOT_APPLICABLE', 'MISS', 'HIT')",
    "status IN ('PENDING', 'SUCCEEDED', 'FAILED')",
    'hive.start_search_operation',
    'hive.complete_search_operation',
    'hive.complete_search_operation_accounted',
    'hive.fail_search_operation',
    'hive.fail_search_operation_accounted',
    'max_results BETWEEN 1 AND 50',
    'target_max_results NOT BETWEEN 1 AND 50',
    'request_count BETWEEN 1 AND 3',
    'target_request_count NOT BETWEEN 1 AND 3',
    'target_provider_request_count NOT BETWEEN 1 AND 3',
    'estimated_cost > 0',
    'actual_cost > 0',
    'target_estimated_cost <= 0',
    'target_actual_cost <= 0',
    'selected_reservation.estimated_amount IS DISTINCT FROM selected_operation.estimated_cost',
    "target_cache_status IS DISTINCT FROM 'NOT_APPLICABLE'",
    'target_cache_status IS DISTINCT FROM selected_operation.cache_status',
    "target_sanitization_mode = 'ABSTRACT_QUERY'",
    "'SEARCH_REQUESTS'",
    "'REQUESTS'",
    'audit.capture_search_operation_transition',
    'audit_search_operations_after_transition',
    'SEARCH_OPERATION_COMPLETED',
    'SEARCH_OPERATION_FAILED',
    "'SEARCH_OPERATION'",
    'raw queries, URLs, snippets and results are prohibited',
  ]) {
    if (!allSql.includes(searchMarker)) {
      errors.push(`Search Gateway operation contract is missing marker: ${searchMarker}`);
    }
  }
  const searchTableSql = /CREATE TABLE hive\.search_operations\s*\(([\s\S]*?)\n\);/i.exec(allSql)?.[1] ?? '';
  if (!searchTableSql) {
    errors.push('Search Gateway operation table definition cannot be inspected');
  } else if (
    /\b(query|query_text|raw_query|url|source_url|snippet|result|results|content|payload)\s+(text|varchar|character|jsonb?|bytea)\b/i.test(searchTableSql)
  ) {
    errors.push('hive.search_operations must not persist raw query, URL, snippet, content or result data');
  }
  for (const scopedCode of ['search_type', 'capability_code']) {
    if (!new RegExp(
      `pg_catalog\\.left\\(\\s*target_${scopedCode},\\s*pg_catalog\\.char_length\\(hive\\.current_app_code\\(\\)\\)\\s*\\+\\s*1\\s*\\)\\s+IS\\s+DISTINCT\\s+FROM\\s+hive\\.current_app_code\\(\\)\\s*\\|\\|\\s*'_'`,
      'i',
    ).test(allSql)) {
      errors.push(`Search Gateway ${scopedCode} must use a literal trusted app-code prefix`);
    }
  }
  const searchServiceFunctions = [
    'hive.start_search_operation\\(\\s*uuid,\\s*text,\\s*text,\\s*text,\\s*text,\\s*text,\\s*text,\\s*text,\\s*text,\\s*integer,\\s*text,\\s*text,\\s*numeric,\\s*text\\s*\\)',
    'hive.complete_search_operation_accounted\\(\\s*text,\\s*uuid,\\s*integer,\\s*integer,\\s*numeric,\\s*text\\s*\\)',
    'hive.fail_search_operation\\(\\s*text,\\s*text\\s*\\)',
    'hive.fail_search_operation_accounted\\(\\s*text,\\s*uuid,\\s*text\\s*\\)',
  ];
  for (const searchFunction of searchServiceFunctions) {
    for (const deniedRole of ['PUBLIC', 'authenticated']) {
      if (!new RegExp(
        `REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+${searchFunction}\\s+FROM\\s+${deniedRole}`,
        'i',
      ).test(allSql)) {
        errors.push(`Search Gateway function ${searchFunction} must be revoked from ${deniedRole}`);
      }
    }
    if (!new RegExp(
      `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${searchFunction}\\s+TO\\s+service_role`,
      'i',
    ).test(allSql)) {
      errors.push(`Search Gateway function ${searchFunction} must be granted only to service_role`);
    }
  }
  const privateSearchComplete =
    'hive.complete_search_operation\\(\\s*text,\\s*integer,\\s*integer,\\s*numeric,\\s*text\\s*\\)';
  for (const deniedRole of ['PUBLIC', 'authenticated', 'service_role']) {
    if (!new RegExp(
      `REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+${privateSearchComplete}\\s+FROM\\s+${deniedRole}`,
      'i',
    ).test(allSql)) {
      errors.push(`Search Gateway private completion helper must be revoked from ${deniedRole}`);
    }
    if (new RegExp(
      `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${privateSearchComplete}\\s+TO\\s+${deniedRole}`,
      'i',
    ).test(allSql)) {
      errors.push(`Search Gateway private completion helper must not be granted to ${deniedRole}`);
    }
  }
  if (/GRANT\s+SELECT\s*\([\s\S]{0,1000}\brequest_fingerprint_sha256\b[\s\S]{0,300}ON\s+hive\.search_operations\s+TO\s+authenticated/i.test(allSql)) {
    errors.push('authenticated must not receive the Search Gateway request fingerprint');
  }
  for (const fileMarker of [
    'CREATE TABLE hive.files',
    'files_project_scope_fk',
    'files_idempotency_unique',
    'files_storage_identity_unique',
    "status IN ('PROCESSING', 'READY', 'DELETED')",
    'idempotency_key_sha256 text',
    'request_fingerprint_sha256 text',
    'original_filename text',
    'media_type text',
    'byte_size bigint',
    'sensitivity text',
    'storage_provider text',
    'storage_bucket text',
    'storage_key text',
    'content_sha256 text',
    'object_version text',
    'required_capability text',
    'hive.can_project_capability',
    'hive.prepare_generated_file',
    'hive.complete_generated_file',
    'hive.abort_generated_file',
    'hive.soft_delete_file',
    'hive.record_file_export',
    "'green-hive-generated', false",
    "'FILE'",
    'files_owner_select',
    'REVOKE ALL ON hive.files FROM PUBLIC',
    'physical references remain server-only',
  ]) {
    if (!allSql.includes(fileMarker)) {
      errors.push(`Private Files contract is missing marker: ${fileMarker}`);
    }
  }
  const filesTableSql = /CREATE TABLE hive\.files\s*\(([\s\S]*?)\n\);/i.exec(allSql)?.[1] ?? '';
  if (!filesTableSql) {
    errors.push('Private Files table definition cannot be inspected');
  } else if (/\b(content|content_bytes|body|payload|file_data)\s+(text|varchar|character|jsonb?|bytea)\b/i.test(filesTableSql)) {
    errors.push('hive.files must not persist file bytes or raw generated content');
  }
  const fileServiceFunctions = [
    'hive.prepare_generated_file\\(\\s*uuid,\\s*text,\\s*text,\\s*text,\\s*text,\\s*bigint,\\s*text,\\s*text,\\s*text,\\s*text,\\s*text\\s*\\)',
    'hive.complete_generated_file\\(\\s*uuid,\\s*text\\s*\\)',
    'hive.abort_generated_file\\(\\s*uuid\\s*\\)',
    'hive.soft_delete_file\\(\\s*uuid\\s*\\)',
    'hive.record_file_export\\(\\s*uuid,\\s*uuid\\s*\\)',
    'hive.prepare_worker_rendered_file\\(\\s*uuid,\\s*text,\\s*text,\\s*text,\\s*text,\\s*bigint,\\s*text,\\s*text,\\s*text\\s*\\)',
    'hive.complete_worker_rendered_file\\(\\s*uuid,\\s*text,\\s*text,\\s*uuid,\\s*text\\s*\\)',
    'hive.abort_worker_rendered_file\\(\\s*uuid,\\s*text,\\s*text,\\s*uuid\\s*\\)',
  ];
  for (const fileFunction of fileServiceFunctions) {
    for (const deniedRole of ['PUBLIC', 'authenticated']) {
      if (!new RegExp(
        `REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+${fileFunction}\\s+FROM\\s+${deniedRole}`,
        'i',
      ).test(allSql)) {
        errors.push(`Private Files function ${fileFunction} must be revoked from ${deniedRole}`);
      }
    }
    if (!new RegExp(
      `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${fileFunction}\\s+TO\\s+service_role`,
      'i',
    ).test(allSql)) {
      errors.push(`Private Files function ${fileFunction} must be granted only to service_role`);
    }
  }
  const filesOwnerGrant = /GRANT\s+SELECT\s*\(([^;]{1,1600}?)\)\s+ON\s+hive\.files\s+TO\s+authenticated/i.exec(allSql)?.[1];
  if (!filesOwnerGrant) {
    errors.push('authenticated must receive a bounded safe-column grant on hive.files');
  } else {
    for (const privateColumn of [
      'idempotency_key_sha256',
      'request_fingerprint_sha256',
      'storage_provider',
      'storage_bucket',
      'storage_key',
      'content_sha256',
      'object_version',
      'required_capability',
    ]) {
      if (new RegExp(`\\b${privateColumn}\\b`, 'i').test(filesOwnerGrant)) {
        errors.push(`authenticated must not receive the Private Files column ${privateColumn}`);
      }
    }
  }
  const filesPolicySql = /CREATE POLICY files_owner_select[\s\S]*?USING\s*\(([\s\S]{1,1400}?)\);/i.exec(allSql)?.[1];
  if (!filesPolicySql) {
    errors.push('Private Files owner-only policy cannot be inspected');
  } else if (/hive\.is_platform_admin\s*\(/i.test(filesPolicySql)) {
    errors.push('Private Files owner policy must not grant implicit platform-admin access');
  }
  for (const requiredMarker of [
    'app_code text',
    'app_version text',
    'schema_namespace text',
    'REFERENCES auth.users(id) ON DELETE CASCADE',
    'REFERENCES auth.users(id) ON DELETE RESTRICT',
    "status IN ('DRAFT', 'ACTIVE', 'ARCHIVED', 'DELETED')",
    'deleted_at timestamptz',
  ]) {
    if (!allSql.includes(requiredMarker)) errors.push(`database contract is missing: ${requiredMarker}`);
  }

  for (const term of forbiddenHiveDomainTerms) {
    if (new RegExp(`\\b${term}\\b`, 'i').test(allSql)) {
      errors.push(`app-domain term ${term} leaked into Hive migrations`);
    }
  }

  try {
    const manifest = JSON.parse(
      await readFile(path.join(repositoryRoot, 'apps', 'hive-reference-app', 'app.manifest.json'), 'utf8'),
    );
    const seedPath = path.join(repositoryRoot, 'database', 'seeds', '0001_reference_app.sql');
    const seed = await readFile(seedPath, 'utf8');
    for (const marker of [
      "'00000000-0000-4000-8000-000000000001'::uuid",
      "'REFERENCE_APP'",
      "'0.1.0'",
      "'INTERNAL'",
      "'reference_app'",
    ]) {
      if (!seed.includes(marker)) errors.push(`REFERENCE_APP seed is missing canonical marker ${marker}`);
    }
    const embeddedManifest = /'(\{[\s\S]*?\})'::jsonb,\s*'\{\"seed\"/.exec(seed)?.[1];
    if (!embeddedManifest) {
      errors.push('REFERENCE_APP seed does not contain its canonical manifest JSON');
    } else if (
      JSON.stringify(stableJson(JSON.parse(embeddedManifest))) !== JSON.stringify(stableJson(manifest))
    ) {
      errors.push('REFERENCE_APP seed manifest differs from app.manifest.json');
    }

    const seedFiles = (await readdir(path.join(repositoryRoot, 'database', 'seeds')))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    if (
      JSON.stringify(seedFiles) !==
      JSON.stringify([
        '0001_reference_app.sql',
        '0002_reference_app_billing_catalog.sql',
        '0003_reference_app_entitlements.sql',
        '0004_reference_app_jobs.sql',
      ])
    ) {
      errors.push(
        'operational seeds must contain only the canonical REFERENCE_APP app, billing catalog, entitlement mapping and job registration',
      );
    }
    if (/auth\.users|OTHER_TEST_APP|10000000-0000-4000-8000/i.test(seed)) {
      errors.push('test identities leaked into the operational seed');
    }

    const billingSeed = await readFile(
      path.join(repositoryRoot, 'database', 'seeds', '0002_reference_app_billing_catalog.sql'),
      'utf8',
    );
    const manifestProduct = manifest.products.find(
      (product) => product.productCode === 'REFERENCE_APP_SANDBOX',
    );
    if (!manifestProduct || manifestProduct.productType !== 'ONE_TIME') {
      errors.push('REFERENCE_APP manifest lacks the canonical sandbox billing product');
    }
    for (const marker of [
      "'40000000-0000-4000-8000-000000000001'::uuid",
      "'50000000-0000-4000-8000-000000000001'::uuid",
      "'REFERENCE_APP_SANDBOX'",
      "'ONE_TIME'",
      "'BRL'",
      '0.000000',
    ]) {
      if (!billingSeed.includes(marker)) {
        errors.push(`REFERENCE_APP billing seed is missing canonical marker ${marker}`);
      }
    }
    if (/auth\.users|OTHER_TEST_APP|10000000-0000-4000-8000/i.test(billingSeed)) {
      errors.push('test identities leaked into the operational billing seed');
    }

    const entitlementSeed = await readFile(
      path.join(repositoryRoot, 'database', 'seeds', '0003_reference_app_entitlements.sql'),
      'utf8',
    );
    const manifestCapabilities = [...manifest.entitlementCapabilities].sort();
    const seededCapabilities = [
      ...entitlementSeed.matchAll(/'([A-Z][A-Z0-9_]+)'/g),
    ]
      .map((match) => match[1])
      .filter((code) => code.startsWith('REFERENCE_APP_') && code !== 'REFERENCE_APP_SANDBOX');
    const uniqueSeededCapabilities = [...new Set(seededCapabilities)].sort();
    if (
      JSON.stringify(uniqueSeededCapabilities)
      !== JSON.stringify(manifestCapabilities)
    ) {
      errors.push('REFERENCE_APP entitlement seed differs from the App Manifest capabilities');
    }
    for (const marker of [
      "'40000000-0000-4000-8000-000000000001'::uuid",
      "'REFERENCE_APP_RUN_JOB'",
      "'REFERENCE_APP_GENERATE_FILE'",
      'hive.apply_entitlement_state_for_purchase',
    ]) {
      if (!entitlementSeed.includes(marker)) {
        errors.push(`REFERENCE_APP entitlement seed is missing canonical marker ${marker}`);
      }
    }
    if (/auth\.users|OTHER_TEST_APP|10000000-0000-4000-8000/i.test(entitlementSeed)) {
      errors.push('test identities leaked into the operational entitlement seed');
    }

    const jobSeed = await readFile(
      path.join(repositoryRoot, 'database', 'seeds', '0004_reference_app_jobs.sql'),
      'utf8',
    );
    if (
      JSON.stringify([...manifest.jobTypes].sort())
      !== JSON.stringify(['REFERENCE_APP_FAKE_AI_JOB', 'REFERENCE_APP_RENDER_PROJECT_DOCUMENT'])
    ) {
      errors.push('REFERENCE_APP job seed differs from the App Manifest job types');
    }
    for (const marker of [
      "'70000000-0000-4000-8000-000000000001'::uuid",
      "'REFERENCE_APP_FAKE_AI_JOB'",
      "'REFERENCE_APP_RENDER_PROJECT_DOCUMENT'",
      "'REFERENCE_APP_RUN_JOB'",
      "'REFERENCE_APP_GENERATE_FILE'",
      "'EXPONENTIAL_BACKOFF'",
      "'PROJECT_OWNER_KEY'",
    ]) {
      if (!jobSeed.includes(marker)) {
        errors.push(`REFERENCE_APP job seed is missing canonical marker ${marker}`);
      }
    }
    if (/auth\.users|OTHER_TEST_APP|10000000-0000-4000-8000/i.test(jobSeed)) {
      errors.push('test identities leaked into the operational job seed');
    }

    const fixture = await readFile(
      path.join(repositoryRoot, 'database', 'tests', 'fixtures', '0001_rls_identities.sql'),
      'utf8',
    );
    for (const marker of ['auth.users', 'OTHER_TEST_APP', 'User A', 'Platform Admin']) {
      if (!fixture.includes(marker)) errors.push(`RLS fixture is missing ${marker}`);
    }
  } catch (error) {
    errors.push(`Unable to validate REFERENCE_APP seed/fixture separation: ${error.message}`);
  }

  return errors;
}

async function main() {
  const errors = await validateDatabaseLayout();
  if (errors.length > 0) {
    console.error('Database validation failed:');
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  const catalog = await loadMigrationCatalog(defaultRepositoryRoot);
  console.log(
    `Database validation passed: ${catalog.migrations.length} immutable migrations, ` +
      `${expectedPolicies.size + requiredAuditTables.length} RLS-protected tables and canonical seed isolation verified.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(thisFile)) {
  await main();
}
