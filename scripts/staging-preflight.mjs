import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import {
  assertNativeSupabaseContract,
  FIXTURE_APP_ID,
  FIXTURE_USER_IDS,
} from './lib/local-supabase-guard.mjs';
import { loadMigrationCatalog } from './lib/migration-catalog.mjs';
import { planPendingMigrations } from './lib/migration-state.mjs';
import {
  stagingConfigurationFromEnvironment,
  stagingDatabaseConfigurationFromEnvironment,
} from './lib/staging-guard.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const supabaseEntrypoint = path.join(repositoryRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');

function listAuthorizedProjects() {
  if (!existsSync(supabaseEntrypoint)) {
    throw new Error('Versioned Supabase CLI is missing. Run npm ci first.');
  }
  const result = spawnSync(
    process.execPath,
    [supabaseEntrypoint, 'projects', 'list', '--output', 'json'],
    { cwd: repositoryRoot, encoding: 'utf8', stdio: 'pipe' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error('Supabase CLI is not authenticated. Run `npx supabase login --agent no`.');
  }
  return JSON.parse(result.stdout);
}

function findConfirmedProject(projects, configuration) {
  const project = projects.find(
    (entry) => entry.id === configuration.projectRef || entry.ref === configuration.projectRef,
  );
  if (!project) throw new Error('Confirmed staging project is not visible to the authenticated account');
  if (project.name !== configuration.projectName) {
    throw new Error('GREEN_HIVE_STAGING_PROJECT_NAME does not match the remote project');
  }
  if (project.region !== configuration.region) {
    throw new Error('GREEN_HIVE_STAGING_REGION does not match the remote project');
  }
  if (project.status && !['ACTIVE_HEALTHY', 'ACTIVE'].includes(project.status)) {
    throw new Error(`Staging project is not healthy: ${project.status}`);
  }
  return project;
}

async function inspectManagedState(client) {
  const catalog = await loadMigrationCatalog(repositoryRoot);
  const schemas = await client.query(
    `SELECT nspname
     FROM pg_namespace
     WHERE nspname = ANY($1::text[])
     ORDER BY nspname`,
    [['hive', 'audit', 'reference_app']],
  );
  const ledger = await client.query("SELECT to_regclass('hive.schema_migrations')::text AS ledger");
  if (ledger.rows[0]?.ledger !== 'hive.schema_migrations') {
    if (schemas.rows.length > 0) {
      throw new Error('Managed schemas exist without the canonical Green Hive migration ledger');
    }
    return Object.freeze({ state: 'EMPTY_READY', applied: 0, pending: catalog.migrations.length });
  }

  const applied = await client.query(
    `SELECT version, name, checksum_sha256, rollback_strategy
     FROM hive.schema_migrations
     ORDER BY version`,
  );
  const pending = planPendingMigrations(catalog.migrations, applied.rows);
  const artifacts = await client.query(
    `SELECT
       (SELECT count(*)::integer FROM auth.users WHERE id = ANY($1::uuid[])) AS users,
       (SELECT count(*)::integer FROM hive.user_profiles WHERE user_id = ANY($1::uuid[])) AS profiles,
       (SELECT count(*)::integer FROM hive.projects WHERE owner_user_id = ANY($1::uuid[])) AS projects,
       (SELECT count(*)::integer
          FROM hive.project_settings
         WHERE project_id IN (
           SELECT id FROM hive.projects WHERE owner_user_id = ANY($1::uuid[])
         )) AS settings,
       (SELECT count(*)::integer FROM hive.apps WHERE id = $2::uuid) AS apps`,
    [FIXTURE_USER_IDS, FIXTURE_APP_ID],
  );
  const testArtifacts = artifacts.rows[0];
  if (Object.values(testArtifacts).some((count) => count !== 0)) {
    throw new Error(`Disposable staging fixtures remain after cleanup: ${JSON.stringify(testArtifacts)}`);
  }
  return Object.freeze({
    state: pending.length === 0 ? 'BASELINE_READY' : 'MIGRATIONS_PENDING',
    applied: applied.rows.length,
    pending: pending.length,
    testArtifacts,
  });
}

export async function runStagingPreflight(options = {}) {
  const databaseOnly = options.databaseOnly ?? false;
  const configuration = databaseOnly
    ? stagingDatabaseConfigurationFromEnvironment()
    : stagingConfigurationFromEnvironment();
  const projects = listAuthorizedProjects();
  const project = findConfirmedProject(projects, configuration);
  const client = new pg.Client({ connectionString: configuration.databaseUrl.toString() });
  await client.connect();
  let managedState;
  try {
    await assertNativeSupabaseContract(client);
    managedState = await inspectManagedState(client);
  } finally {
    await client.end();
  }

  const result = Object.freeze({
    projectRef: configuration.projectRef,
    projectName: configuration.projectName,
    region: configuration.region,
    status: project.status ?? 'VISIBLE',
    managedState,
    ...(databaseOnly
      ? { boundary: 'DATABASE_BASELINE_ONLY' }
      : {
          boundary: 'HTTPS_AUTH_SMTP',
          appOrigin: configuration.appOrigin.origin,
          recoveryRedirect: configuration.recoveryRedirect.href,
        }),
  });
  console.log(JSON.stringify(result, null, 2));
  return { configuration, project, managedState };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runStagingPreflight({ databaseOnly: process.argv.includes('--database-only') });
}
