import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { GoTrueClient } from '@supabase/supabase-js';
import { AppRegistry } from '../../packages/core/dist/index.js';
import {
  AuthError,
  AuthService,
  PostgresAuthenticatedSessionRunner,
  SupabaseServerAuthProvider,
} from '../../packages/auth/dist/index.js';
import { ProjectError } from '../../packages/projects/dist/index.js';
import {
  ReferenceAppServer,
  referenceAppManifest,
} from '../../apps/hive-reference-app/dist/index.js';
import {
  assertNativeSupabaseContract,
  cleanupGreenHiveUserData,
} from '../../scripts/lib/local-supabase-guard.mjs';
import { stagingDatabaseConfigurationFromEnvironment } from '../../scripts/lib/staging-guard.mjs';

const databaseUrl = process.env.GREEN_HIVE_TEST_DATABASE_URL;
const authUrl = process.env.GREEN_HIVE_SUPABASE_AUTH_URL;
const publishableKey = process.env.GREEN_HIVE_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.GREEN_HIVE_SUPABASE_SERVICE_ROLE_KEY;

function hasAuthCode(code) {
  return (error) => error instanceof AuthError && error.code === code;
}

function hasProjectCode(code) {
  return (error) => error instanceof ProjectError && error.code === code;
}

function adminClient() {
  return new GoTrueClient({
    url: authUrl,
    headers: { apikey: serviceRoleKey },
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  });
}

test(
  'GH-0201 Auth/account core flow on dedicated Supabase staging',
  {
    skip:
      !databaseUrl || !authUrl || !publishableKey || !serviceRoleKey
        ? 'dedicated staging Auth gate not configured'
        : false,
  },
  async (testContext) => {
    const staging = stagingDatabaseConfigurationFromEnvironment();
    assert.equal(staging.databaseUrl.toString(), new URL(databaseUrl).toString());
    assert.equal(authUrl, `https://${staging.projectRef}.supabase.co/auth/v1`);
    assert.equal(process.env.GREEN_HIVE_TEST_PREPARED, 'SUPABASE_STAGING_BASELINE_READY');

    const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
    const maintenance = await pool.connect();
    const createdUserIds = [];
    const stamp = `${Date.now()}-${process.pid}`;
    const emailA = `staging-owner-a-${stamp}@example.test`;
    const emailB = `staging-owner-b-${stamp}@example.test`;
    const passwordA = 'StageOwnerAlpha123!';
    const passwordB = 'StageOwnerBravo456!';
    const provider = new SupabaseServerAuthProvider({
      authUrl,
      publishableKey,
      serviceRoleKey,
    });
    const registry = new AppRegistry();
    registry.register(referenceAppManifest);
    const authService = new AuthService(provider, registry, { allowedRecoveryRedirects: [] });
    const server = new ReferenceAppServer({
      authService,
      sessionRunner: new PostgresAuthenticatedSessionRunner(pool),
      recoveryRedirectUrl: 'https://staging.invalid/auth/recovery',
    });
    const admin = adminClient();
    let sessionA;
    let sessionB;
    let workspaceA;
    let workspaceB;
    let projectA;

    try {
      await assertNativeSupabaseContract(maintenance);

      await testContext.test('server-only key reaches the hosted Auth Admin API', async () => {
        const listed = await admin.admin.listUsers({ page: 1, perPage: 1 });
        const detail = listed.error
          ? `status=${listed.error.status ?? 'unknown'} code=${listed.error.code ?? 'unknown'} message=${listed.error.message}`
          : 'ok';
        assert.equal(listed.error, null, `Hosted Auth Admin preflight failed: ${detail}`);
      });

      await testContext.test('signup creates confirmed users and isolated owner profiles', async () => {
        sessionA = await server.signUp({ email: emailA, password: passwordA });
        sessionB = await server.signUp({ email: emailB, password: passwordB });
        createdUserIds.push(sessionA.user.id, sessionB.user.id);
        [workspaceA] = await server.listWorkspaces(sessionA.accessToken);
        [workspaceB] = await server.listWorkspaces(sessionB.accessToken);
        assert.equal(workspaceA.kind, 'PERSONAL');
        assert.equal(workspaceB.kind, 'PERSONAL');
        assert.notEqual(workspaceA.id, workspaceB.id);
        assert.equal(sessionA.user.appCode, 'REFERENCE_APP');
        assert.equal((await server.getMe(sessionA.accessToken)).userId, sessionA.user.id);
        assert.equal((await server.getMe(sessionB.accessToken)).userId, sessionB.user.id);

        const native = await maintenance.query(
          `SELECT id::text, email_confirmed_at IS NOT NULL AS confirmed
           FROM auth.users
           WHERE id = ANY($1::uuid[])
           ORDER BY id`,
          [createdUserIds],
        );
        assert.equal(native.rows.length, 2);
        assert.ok(native.rows.every((row) => row.confirmed));
      });
      if (!sessionA || !sessionB) throw new Error('Staging account bootstrap failed');

      await testContext.test('profile and project access remain owner-only', async () => {
        const updated = await server.updateMe(sessionA.accessToken, {
          displayName: 'Staging Owner A',
          preferredLanguage: 'pt',
          preferredLocale: 'pt-BR',
          timezone: 'America/Sao_Paulo',
        });
        assert.equal(updated.displayName, 'Staging Owner A');

        projectA = await server.createProject(sessionA.accessToken, workspaceA.id, {
          name: 'Staging project A',
          metadata: { checkpoint: 'GH-0201-STAGING' },
        });
        assert.equal(projectA.ownerUserId, sessionA.user.id);
        assert.equal((await server.listProjects(sessionA.accessToken, workspaceA.id)).length, 1);
        assert.deepEqual(await server.listProjects(sessionB.accessToken, workspaceB.id), []);
        await assert.rejects(
          server.getProject(sessionB.accessToken, workspaceB.id, projectA.id),
          hasProjectCode('PROJECT_NOT_FOUND'),
        );
      });

      await testContext.test('user_metadata cannot forge app or platform administration', async () => {
        const changed = await admin.admin.updateUserById(sessionA.user.id, {
          user_metadata: {
            app_code: 'OTHER_TEST_APP',
            platform_role: 'PLATFORM_ADMIN',
          },
        });
        assert.equal(changed.error, null);
        sessionA = await server.signIn({ email: emailA, password: passwordA });
        assert.equal(sessionA.user.appCode, 'REFERENCE_APP');
        assert.equal(sessionA.user.platformRole, undefined);
        assert.equal((await server.listProjects(sessionA.accessToken, workspaceA.id)).length, 1);
      });

      await testContext.test('only controlled app_metadata selects the active app', async () => {
        const changed = await admin.admin.updateUserById(sessionA.user.id, {
          app_metadata: { app_code: 'OTHER_TEST_APP' },
        });
        assert.equal(changed.error, null);
        await assert.rejects(
          server.signIn({ email: emailA, password: passwordA }),
          hasAuthCode('AUTH_APP_NOT_ALLOWED'),
        );

        const restored = await admin.admin.updateUserById(sessionA.user.id, {
          app_metadata: { app_code: 'REFERENCE_APP' },
        });
        assert.equal(restored.error, null);
        sessionA = await server.signIn({ email: emailA, password: passwordA });
      });

      await testContext.test('refresh rotates the session and logout revokes it', async () => {
        const refreshed = await server.refreshSession({ refreshToken: sessionA.refreshToken });
        assert.notEqual(refreshed.refreshToken, sessionA.refreshToken);
        sessionA = refreshed;
        await server.signOut({ accessToken: sessionA.accessToken, scope: 'local' });
        await assert.rejects(
          server.refreshSession({ refreshToken: sessionA.refreshToken }),
          hasAuthCode('AUTH_SESSION_REFRESH_FAILED'),
        );
      });

      await testContext.test('invalid credentials and tokens return stable public errors', async () => {
        await assert.rejects(
          server.signIn({ email: emailB, password: 'WrongPassword789!' }),
          hasAuthCode('AUTH_INVALID_CREDENTIALS'),
        );
        await assert.rejects(
          server.getMe('not-a-valid-access-token'),
          hasAuthCode('AUTH_SESSION_INVALID'),
        );
      });
    } finally {
      await maintenance.query('RESET ROLE').catch(() => undefined);
      if (createdUserIds.length > 0) {
        await cleanupGreenHiveUserData(maintenance, createdUserIds).catch(() => undefined);
        for (const userId of createdUserIds) {
          await admin.admin.deleteUser(userId).catch(() => undefined);
        }
      }
      maintenance.release();
      await pool.end();
    }
  },
);
