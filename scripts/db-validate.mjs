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
    if (JSON.stringify(seedFiles) !== JSON.stringify(['0001_reference_app.sql'])) {
      errors.push('operational seeds must contain only 0001_reference_app.sql at this checkpoint');
    }
    if (/auth\.users|OTHER_TEST_APP|10000000-0000-4000-8000/i.test(seed)) {
      errors.push('test identities leaked into the operational seed');
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
