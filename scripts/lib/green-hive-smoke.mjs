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
     )
     ORDER BY conname`,
  );
  assert.deepEqual(foreignKeys.rows, [
    { conname: 'audit_events_app_fk', target: 'hive.apps' },
    { conname: 'audit_events_organization_fk', target: 'hive.organizations' },
    { conname: 'audit_events_project_scope_fk', target: 'hive.projects' },
    { conname: 'organization_apps_installer_membership_fk', target: 'hive.organization_members' },
    { conname: 'organization_members_user_fk', target: 'auth.users' },
    { conname: 'project_settings_project_app_organization_fk', target: 'hive.projects' },
    { conname: 'projects_organization_app_fk', target: 'hive.organization_apps' },
    { conname: 'projects_organization_membership_fk', target: 'hive.organization_members' },
    { conname: 'projects_owner_fk', target: 'auth.users' },
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
         'project_settings'
       ))
       OR (pg_namespace.nspname = 'audit' AND relname = 'events')
     ORDER BY schema_name, relname`,
  );
  assert.equal(rls.rows.length, 9);
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
     ]) AS names(name)`,
  );
  assert.equal(helpers.rows.length, 18);
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

  const auditTriggers = await client.query(
    `SELECT tgname
     FROM pg_trigger
     WHERE tgname IN (
       'audit_organizations_after_insert',
       'audit_organization_members_after_change',
       'audit_organization_apps_after_insert',
       'audit_projects_after_lifecycle'
     )
       AND NOT tgisinternal
     ORDER BY tgname`,
  );
  assert.equal(auditTriggers.rows.length, 4);

  return Object.freeze({ ledgerRows: ledger.rows.length, referenceApps: seed.rows.length });
}
