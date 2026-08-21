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
  assertLocalSupabaseTarget,
  assertNativeSupabaseContract,
  cleanupGreenHiveUsers,
} from '../../scripts/lib/local-supabase-guard.mjs';

const databaseUrl = process.env.GREEN_HIVE_TEST_DATABASE_URL;
const target = process.env.GREEN_HIVE_TEST_TARGET;
const confirmation = process.env.GREEN_HIVE_TEST_CONFIRM;
const authUrl = process.env.GREEN_HIVE_SUPABASE_AUTH_URL;
const publishableKey = process.env.GREEN_HIVE_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.GREEN_HIVE_SUPABASE_SERVICE_ROLE_KEY;
const mailpitUrl = process.env.GREEN_HIVE_MAILPIT_URL;
const recoveryRedirect = process.env.GREEN_HIVE_AUTH_RECOVERY_REDIRECT;

function hasAuthCode(code) {
  return (error) => error instanceof AuthError && error.code === code;
}

function hasProjectCode(code) {
  return (error) => error instanceof ProjectError && error.code === code;
}

function adminClient() {
  return new GoTrueClient({
    url: authUrl,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  });
}

async function waitForRecoveryEmail(email) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${mailpitUrl}/api/v1/messages`);
    if (!response.ok) throw new Error('Mailpit could not be queried');
    const payload = await response.json();
    const message = (payload.messages ?? []).find((entry) =>
      JSON.stringify(entry).toLowerCase().includes(email.toLowerCase()),
    );
    if (message?.ID) {
      const fullResponse = await fetch(`${mailpitUrl}/api/v1/message/${message.ID}`);
      if (!fullResponse.ok) throw new Error('Mailpit message could not be read');
      return fullResponse.json();
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Password recovery email was not captured by local Mailpit');
}

test(
  'GH-0201 Auth/account flow on native local Supabase',
  {
    skip:
      !databaseUrl ||
      !target ||
      !confirmation ||
      !authUrl ||
      !publishableKey ||
      !serviceRoleKey ||
      !mailpitUrl ||
      !recoveryRedirect
        ? 'local Supabase Auth gate not configured'
        : false,
  },
  async (testContext) => {
    assertLocalSupabaseTarget({ databaseUrl, target, confirmation });
    assert.equal(authUrl, 'http://127.0.0.1:54321');
    assert.equal(mailpitUrl, 'http://127.0.0.1:54324');

    const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
    const maintenance = await pool.connect();
    const createdUserIds = [];
    const stamp = `${Date.now()}-${process.pid}`;
    const emailA = `gh0201-owner-a-${stamp}@example.test`;
    const emailB = `gh0201-owner-b-${stamp}@example.test`;
    const passwordA = 'OwnerAlpha123';
    const passwordB = 'OwnerBravo456';
    const provider = new SupabaseServerAuthProvider({
      authUrl,
      publishableKey,
      serviceRoleKey,
    });
    const registry = new AppRegistry();
    registry.register(referenceAppManifest);
    const authService = new AuthService(provider, registry, {
      allowedRecoveryRedirects: [recoveryRedirect],
    });
    const sessionRunner = new PostgresAuthenticatedSessionRunner(pool);
    const server = new ReferenceAppServer({
      authService,
      sessionRunner,
      recoveryRedirectUrl: recoveryRedirect,
    });
    const admin = adminClient();
    let sessionA;
    let sessionB;
    let workspaceA;
    let workspaceB;
    let projectA;

    try {
      await assertNativeSupabaseContract(maintenance);

      await testContext.test('signup creates confirmed Auth users and owner profiles', async () => {
        sessionA = await server.signUp({ email: emailA, password: passwordA });
        sessionB = await server.signUp({ email: emailB, password: passwordB });
        createdUserIds.push(sessionA.user.id, sessionB.user.id);
        [workspaceA] = await server.listWorkspaces(sessionA.accessToken);
        [workspaceB] = await server.listWorkspaces(sessionB.accessToken);
        assert.equal(workspaceA.kind, 'PERSONAL');
        assert.equal(workspaceB.kind, 'PERSONAL');
        assert.notEqual(workspaceA.id, workspaceB.id);
        assert.equal(sessionA.user.appCode, 'REFERENCE_APP');
        assert.equal(sessionA.user.platformRole, undefined);
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

      await testContext.test('profile reads and validated updates remain owner-only', async () => {
        const updated = await server.updateMe(sessionA.accessToken, {
          displayName: '  Owner Alpha  ',
          preferredLanguage: 'pt',
          preferredLocale: 'pt-BR',
          timezone: 'America/Sao_Paulo',
          preferences: { theme: 'dark', compact: true },
        });
        assert.equal(updated.displayName, 'Owner Alpha');
        assert.deepEqual(updated.preferences, { theme: 'dark', compact: true });

        const identityB = await authService.verifyAccessTokenForApp(
          sessionB.accessToken,
          'REFERENCE_APP',
        );
        const crossProfileRows = await sessionRunner.run(identityB, ({ database }) =>
          database.query('SELECT user_id FROM hive.user_profiles WHERE user_id = $1::uuid', [
            sessionA.user.id,
          ]),
        );
        assert.equal(crossProfileRows.rows.length, 0);
        await assert.rejects(
          server.updateMe(sessionA.accessToken, { preferredLocale: 'pt_br' }),
          hasAuthCode('INVALID_ACCOUNT_INPUT'),
        );
      });

      await testContext.test('verified sessions reach Project Service with native RLS', async () => {
        projectA = await server.createProject(sessionA.accessToken, workspaceA.id, {
          name: 'Authenticated project A',
          metadata: { checkpoint: 'GH-0201' },
        });
        assert.equal(projectA.ownerUserId, sessionA.user.id);
        assert.deepEqual((await server.listProjects(sessionA.accessToken, workspaceA.id)).map(({ id }) => id), [
          projectA.id,
        ]);
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
        const fresh = await server.signIn({ email: emailA, password: passwordA });
        sessionA = fresh;
        const identity = await authService.verifyAccessTokenForApp(
          fresh.accessToken,
          'REFERENCE_APP',
        );
        assert.equal(identity.appCode, 'REFERENCE_APP');
        assert.equal(identity.platformRole, undefined);
        assert.equal((await server.listProjects(fresh.accessToken, workspaceA.id)).length, 1);
      });

      await testContext.test('only controlled app_metadata determines the active app', async () => {
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
        assert.equal((await server.listProjects(sessionA.accessToken, workspaceA.id)).length, 1);
      });

      await testContext.test('client payload cannot select app or administrative scope', async () => {
        await assert.rejects(
          server.signUp({
            email: `forged-${stamp}@example.test`,
            password: 'ForgedUser123',
            appCode: 'OTHER_TEST_APP',
          }),
          hasAuthCode('INVALID_AUTH_INPUT'),
        );
        await assert.rejects(
          authService.signUp({
            email: `forged-admin-${stamp}@example.test`,
            password: 'ForgedAdmin123',
            appCode: 'REFERENCE_APP',
            platformRole: 'PLATFORM_ADMIN',
          }),
          hasAuthCode('INVALID_AUTH_INPUT'),
        );
      });

      await testContext.test('session refresh rotates tokens and local sign-out revokes refresh', async () => {
        const refreshed = await server.refreshSession({ refreshToken: sessionA.refreshToken });
        assert.notEqual(refreshed.refreshToken, sessionA.refreshToken);
        sessionA = refreshed;
        assert.equal((await server.getMe(sessionA.accessToken)).userId, sessionA.user.id);
        await server.signOut({ accessToken: sessionA.accessToken, scope: 'local' });
        await assert.rejects(
          server.refreshSession({ refreshToken: sessionA.refreshToken }),
          hasAuthCode('AUTH_SESSION_REFRESH_FAILED'),
        );
      });

      await testContext.test('password recovery link changes the password through local Auth', async () => {
        const challenge = await server.requestPasswordRecovery({ email: emailB });
        const message = await waitForRecoveryEmail(emailB);
        assert.match(message.Subject, /reset your password/i);
        const recoveryUrl = /https?:\/\/[^\s)]+/.exec(message.Text)?.[0];
        assert.ok(recoveryUrl, 'recovery URL must exist in the captured message');
        const verification = await fetch(recoveryUrl, { redirect: 'manual' });
        assert.ok([302, 303].includes(verification.status));
        const location = verification.headers.get('location');
        assert.ok(location, 'recovery verification must redirect to the allowlisted callback');
        const callback = new URL(location);
        assert.equal(`${callback.origin}${callback.pathname}`, recoveryRedirect);
        const code = callback.searchParams.get('code');
        const flowId = callback.searchParams.get('sb_flow_id');
        assert.ok(code, 'PKCE recovery callback must contain a one-time authorization code');
        const recoverySession = await server.exchangePasswordRecoveryCode({
          code,
          state: challenge.state,
          ...(flowId ? { flowId } : {}),
        });
        assert.equal(callback.hash, '', 'PKCE recovery callback must not expose tokens in the URL');

        const recoveredPassword = 'RecoveredBravo789';
        await server.completePasswordRecovery({
          accessToken: recoverySession.accessToken,
          refreshToken: recoverySession.refreshToken,
          newPassword: recoveredPassword,
        });
        await assert.rejects(
          server.signIn({ email: emailB, password: passwordB }),
          hasAuthCode('AUTH_INVALID_CREDENTIALS'),
        );
        sessionB = await server.signIn({ email: emailB, password: recoveredPassword });
        assert.equal(sessionB.user.id, createdUserIds[1]);
      });

      await testContext.test('invalid tokens and wrong passwords return stable public errors', async () => {
        await assert.rejects(
          server.signIn({ email: emailB, password: 'WrongPassword789' }),
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
        await cleanupGreenHiveUsers(maintenance, createdUserIds).catch(() => undefined);
      }
      await maintenance.release();
      await pool.end();
    }
  },
);
