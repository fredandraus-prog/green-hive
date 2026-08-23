import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import pg from 'pg';
import {
  AuditError,
  AuditService,
  PostgresAuditEventRepository,
} from '../../packages/audit/dist/index.js';
import {
  PostgresProjectRepository,
  PostgresWorkspaceRepository,
  ProjectError,
  ProjectService,
  WorkspaceError,
  WorkspaceService,
} from '../../packages/projects/dist/index.js';
import {
  assertLocalSupabaseTarget,
  assertNativeSupabaseContract,
  cleanupGreenHiveFixtures,
} from '../../scripts/lib/local-supabase-guard.mjs';
import {
  stagingDatabaseConfigurationFromEnvironment,
  SUPABASE_STAGING_TARGET,
} from '../../scripts/lib/staging-guard.mjs';
import { loadMigrationCatalog } from '../../scripts/lib/migration-catalog.mjs';
import {
  ADMIN_ID,
  OTHER_APP_ID,
  ORGANIZATION_A_ID,
  ORGANIZATION_B_ID,
  REFERENCE_APP_ID,
  SHARED_ORGANIZATION_ID,
  USER_A_ID,
  USER_B_ID,
} from './helpers/rls-matrix.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const databaseUrl = process.env.GREEN_HIVE_TEST_DATABASE_URL;
const confirmation = process.env.GREEN_HIVE_TEST_CONFIRM;
const target = process.env.GREEN_HIVE_TEST_TARGET;
const isStaging = target === SUPABASE_STAGING_TARGET;

const contextA = {
  userId: USER_A_ID,
  appCode: 'REFERENCE_APP',
  organizationId: ORGANIZATION_A_ID,
};
const contextB = {
  userId: USER_B_ID,
  appCode: 'REFERENCE_APP',
  organizationId: ORGANIZATION_B_ID,
};
const contextAOtherApp = {
  userId: USER_A_ID,
  appCode: 'OTHER_TEST_APP',
  organizationId: ORGANIZATION_A_ID,
};
const contextAOtherOrganization = {
  userId: USER_A_ID,
  appCode: 'REFERENCE_APP',
  organizationId: SHARED_ORGANIZATION_ID,
};
const adminContext = {
  userId: ADMIN_ID,
  appCode: 'REFERENCE_APP',
  organizationId: ORGANIZATION_A_ID,
  platformRole: 'PLATFORM_ADMIN',
};

function claims(subject, appCode, platformRole = 'USER') {
  return JSON.stringify({
    sub: subject,
    app_metadata: { app_code: appCode, platform_role: platformRole },
  });
}

async function setContext(client, subject, appCode, organizationId, platformRole = 'USER') {
  await client.query(
    `SELECT
       set_config('request.jwt.claims', $1, false),
       set_config('request.green_hive.organization_id', $2, false)`,
    [claims(subject, appCode, platformRole), organizationId ?? ''],
  );
}

function hasProjectCode(code) {
  return (error) => error instanceof ProjectError && error.code === code;
}

function hasWorkspaceCode(code) {
  return (error) => error instanceof WorkspaceError && error.code === code;
}

function hasAuditCode(code) {
  return (error) => error instanceof AuditError && error.code === code;
}

async function cleanupFixtures(client) {
  await cleanupGreenHiveFixtures(client);
}

test(
  'GH-0104 Project/Workspace Service and GH-0203 Audit on native local Supabase',
  { skip: !databaseUrl || !confirmation ? 'local Supabase gate not configured' : false },
  async (testContext) => {
    if (isStaging) {
      const staging = stagingDatabaseConfigurationFromEnvironment();
      assert.equal(staging.databaseUrl.toString(), new URL(databaseUrl).toString());
      assert.equal(
        process.env.GREEN_HIVE_TEST_PREPARED,
        'SUPABASE_STAGING_BASELINE_READY',
      );
    } else {
      assertLocalSupabaseTarget({ databaseUrl, target, confirmation });
    }
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    const repository = new PostgresProjectRepository({
      query: (sql, parameters) => client.query(sql, parameters),
    });
    const service = new ProjectService(repository);
    const auditService = new AuditService(
      new PostgresAuditEventRepository({
        query: (sql, parameters) => client.query(sql, parameters),
      }),
    );
    const workspaceService = new WorkspaceService(
      new PostgresWorkspaceRepository({
        query: (sql, parameters) => client.query(sql, parameters),
      }),
    );
    let projectA;
    let sharedWorkspace;

    try {
      await assertNativeSupabaseContract(client);
      const catalog = await loadMigrationCatalog(repositoryRoot);
      const baseline = await client.query(
        `SELECT count(*)::integer AS migrations,
                (SELECT count(*)::integer FROM hive.apps WHERE app_code = 'REFERENCE_APP') AS apps
         FROM hive.schema_migrations`,
      );
      assert.deepEqual(baseline.rows[0], { migrations: catalog.migrations.length, apps: 1 });

      await cleanupFixtures(client);
      const fixture = await readFile(
        path.join(repositoryRoot, 'database', 'tests', 'fixtures', '0001_rls_identities.sql'),
        'utf8',
      );
      await client.query(fixture);
      await client.query('SET ROLE authenticated');

      await testContext.test('personal and shared workspaces are tenant-scoped and idempotent', async () => {
        await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
        const personal = await workspaceService.ensurePersonal({
          userId: USER_A_ID,
          appCode: 'REFERENCE_APP',
        });
        assert.equal(personal.id, ORGANIZATION_A_ID);
        assert.equal(personal.kind, 'PERSONAL');

        sharedWorkspace = await workspaceService.createShared(
          { userId: USER_A_ID, appCode: 'REFERENCE_APP' },
          { name: 'Native Shared Workspace' },
        );
        assert.equal(sharedWorkspace.kind, 'SHARED');
        assert.equal(sharedWorkspace.role, 'OWNER');
        await setContext(client, USER_A_ID, 'REFERENCE_APP', sharedWorkspace.id);
        sharedWorkspace = await workspaceService.rename(
          { userId: USER_A_ID, appCode: 'REFERENCE_APP', organizationId: sharedWorkspace.id },
          { name: 'Native Shared Workspace Renamed' },
        );
        assert.equal(sharedWorkspace.name, 'Native Shared Workspace Renamed');
        await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
        assert.deepEqual(
          (await workspaceService.list({ userId: USER_A_ID, appCode: 'REFERENCE_APP' }))
            .map((workspace) => workspace.id)
            .sort(),
          [ORGANIZATION_A_ID, SHARED_ORGANIZATION_ID, sharedWorkspace.id].sort(),
        );
      });

      await testContext.test('workspace owner can add a bounded role without granting ownership', async () => {
        await setContext(client, USER_A_ID, 'REFERENCE_APP', sharedWorkspace.id);
        const sharedContext = {
          userId: USER_A_ID,
          appCode: 'REFERENCE_APP',
          organizationId: sharedWorkspace.id,
        };
        const member = await workspaceService.addMember(sharedContext, {
          userId: USER_B_ID,
          role: 'ANALYST',
        });
        assert.equal(member.role, 'ANALYST');
        assert.equal((await workspaceService.listMembers(sharedContext)).length, 2);

        await setContext(client, USER_B_ID, 'REFERENCE_APP', sharedWorkspace.id);
        await assert.rejects(
          workspaceService.addMember(
            { ...sharedContext, userId: USER_B_ID },
            { userId: ADMIN_ID, role: 'VIEWER' },
          ),
          hasWorkspaceCode('WORKSPACE_ACCESS_DENIED'),
        );
      });

      await testContext.test('owner creates, lists and gets within the trusted app', async () => {
        await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
        projectA = await service.create(contextA, {
          name: '  Native Project A  ',
          metadata: { source: 'GH-0104', revision: 1 },
        });
        assert.equal(projectA.name, 'Native Project A');
        assert.equal(projectA.ownerUserId, USER_A_ID);
        assert.equal(projectA.organizationId, ORGANIZATION_A_ID);
        assert.equal(projectA.appId, REFERENCE_APP_ID);
        assert.equal(projectA.status, 'DRAFT');
        assert.deepEqual(projectA.metadata, { source: 'GH-0104', revision: 1 });
        assert.deepEqual((await service.list(contextA)).map((project) => project.id), [projectA.id]);
        assert.equal((await service.get(contextA, projectA.id)).id, projectA.id);
      });

      await testContext.test('cross-user and cross-app identifiers do not reveal existence', async () => {
        await setContext(client, USER_B_ID, 'REFERENCE_APP', ORGANIZATION_B_ID);
        await assert.rejects(service.get(contextB, projectA.id), hasProjectCode('PROJECT_NOT_FOUND'));
        await assert.rejects(
          service.archive(contextB, projectA.id),
          hasProjectCode('PROJECT_NOT_FOUND'),
        );

        await setContext(client, USER_A_ID, 'OTHER_TEST_APP', ORGANIZATION_A_ID);
        await assert.rejects(
          service.get(contextAOtherApp, projectA.id),
          hasProjectCode('PROJECT_NOT_FOUND'),
        );
        assert.deepEqual(await service.list(contextAOtherApp), []);

        await setContext(client, USER_A_ID, 'REFERENCE_APP', SHARED_ORGANIZATION_ID);
        await assert.rejects(
          service.get(contextAOtherOrganization, projectA.id),
          hasProjectCode('PROJECT_NOT_FOUND'),
        );
      });

      await testContext.test('payload cannot provide owner or app scope', async () => {
        await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
        await assert.rejects(
          service.create(contextA, { name: 'Forged owner', owner_user_id: USER_B_ID }),
          hasProjectCode('INVALID_PROJECT_INPUT'),
        );
        await assert.rejects(
          service.create(contextA, { name: 'Forged app', app_id: OTHER_APP_ID }),
          hasProjectCode('INVALID_PROJECT_INPUT'),
        );
        await assert.rejects(
          service.create(contextA, {
            name: 'Forged organization',
            organization_id: ORGANIZATION_B_ID,
          }),
          hasProjectCode('INVALID_PROJECT_INPUT'),
        );
        assert.equal((await service.list(contextA)).length, 1);
      });

      await testContext.test('verified JWT and TrustedAppContext must agree', async () => {
        await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
        await assert.rejects(service.list(contextB), hasProjectCode('PROJECT_ACCESS_DENIED'));
        await assert.rejects(
          service.list(contextAOtherApp),
          hasProjectCode('PROJECT_ACCESS_DENIED'),
        );
      });

      await testContext.test('archive is idempotent and preserves project data', async () => {
        await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
        const archived = await service.archive(contextA, projectA.id);
        const archivedAgain = await service.archive(contextA, projectA.id);
        assert.equal(archived.status, 'ARCHIVED');
        assert.equal(archived.name, projectA.name);
        assert.deepEqual(archived.metadata, projectA.metadata);
        assert.equal(archived.createdAt.toISOString(), projectA.createdAt.toISOString());
        assert.equal(archived.archivedAt?.toISOString(), archivedAgain.archivedAt?.toISOString());
        assert.equal(archived.updatedAt.toISOString(), archivedAgain.updatedAt.toISOString());
        const events = await auditService.list(contextA, { limit: 100 });
        assert.deepEqual(
          events
            .filter((event) => event.projectId === projectA.id)
            .map((event) => event.eventCode)
            .sort(),
          ['PROJECT_ARCHIVED', 'PROJECT_CREATED'],
        );
      });

      await testContext.test('soft deletion is idempotent and retained without admin content access', async () => {
        await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
        await service.softDelete(contextA, projectA.id);
        await service.softDelete(contextA, projectA.id);
        assert.deepEqual(await service.list(contextA), []);
        await assert.rejects(service.get(contextA, projectA.id), hasProjectCode('PROJECT_NOT_FOUND'));
        await assert.rejects(
          service.archive(contextA, projectA.id),
          hasProjectCode('PROJECT_NOT_FOUND'),
        );

        await setContext(client, ADMIN_ID, 'REFERENCE_APP', null, 'PLATFORM_ADMIN');
        const hiddenFromAdmin = await client.query(
          'SELECT status, deleted_at FROM hive.projects WHERE id = $1::uuid',
          [projectA.id],
        );
        assert.equal(hiddenFromAdmin.rows.length, 0);

        await client.query('RESET ROLE');
        const retained = await client.query(
          'SELECT status, deleted_at FROM hive.projects WHERE id = $1::uuid',
          [projectA.id],
        );
        assert.equal(retained.rows[0].status, 'DELETED');
        assert.ok(retained.rows[0].deleted_at);
        await client.query('SET ROLE authenticated');
        await setContext(client, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
        const events = await auditService.list(contextA, { limit: 100 });
        assert.deepEqual(
          events
            .filter((event) => event.projectId === projectA.id)
            .map((event) => event.eventCode)
            .sort(),
          ['PROJECT_ARCHIVED', 'PROJECT_CREATED', 'PROJECT_DELETION_REQUESTED'],
        );
      });

      await testContext.test('platform admin sees metadata but private project commands are denied', async () => {
        await setContext(client, ADMIN_ID, 'REFERENCE_APP', null, 'PLATFORM_ADMIN');
        const visible = await client.query('SELECT id FROM hive.projects WHERE id = $1::uuid', [
          projectA.id,
        ]);
        assert.equal(visible.rows.length, 0);
        const organizations = await client.query('SELECT id FROM hive.organizations');
        assert.equal(organizations.rows.length, 4);
        await assert.rejects(
          service.create(adminContext, { name: 'Admin write' }),
          hasProjectCode('PROJECT_ACCESS_DENIED'),
        );
        await assert.rejects(
          service.archive(adminContext, projectA.id),
          hasProjectCode('PROJECT_ACCESS_DENIED'),
        );
        await assert.rejects(
          service.softDelete(adminContext, projectA.id),
          hasProjectCode('PROJECT_ACCESS_DENIED'),
        );
        await assert.rejects(
          auditService.list(adminContext),
          hasAuditCode('AUDIT_ACCESS_DENIED'),
        );
      });
    } finally {
      await cleanupFixtures(client).catch(() => undefined);
      await client.end();
    }
  },
);
