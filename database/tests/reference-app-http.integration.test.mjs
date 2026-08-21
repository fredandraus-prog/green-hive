import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { AppRegistry } from '../../packages/core/dist/index.js';
import {
  AuthService,
  PostgresAuthenticatedSessionRunner,
  SupabaseServerAuthProvider,
} from '../../packages/auth/dist/index.js';
import {
  createReferenceAppHttpServer,
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
const recoveryRedirect = process.env.GREEN_HIVE_AUTH_RECOVERY_REDIRECT;
const origin = 'http://127.0.0.1:3000';

function cookieHeader(response) {
  const values = response.headers['set-cookie'];
  return (Array.isArray(values) ? values : [values])
    .filter(Boolean)
    .map((value) => value.split(';', 1)[0])
    .join('; ');
}

function mergeCookieHeader(current, response) {
  const cookies = new Map(
    current.split('; ').filter(Boolean).map((entry) => entry.split('=', 2)),
  );
  for (const entry of cookieHeader(response).split('; ').filter(Boolean)) {
    const [name, value] = entry.split('=', 2);
    cookies.set(name, value);
  }
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function post(url, payload, cookie) {
  return {
    method: 'POST',
    url,
    headers: {
      origin,
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    payload,
  };
}

test(
  'GH-0201/GH-0202 HTTP and cookie boundary on native local Supabase',
  {
    skip:
      !databaseUrl ||
      !target ||
      !confirmation ||
      !authUrl ||
      !publishableKey ||
      !serviceRoleKey ||
      !recoveryRedirect
        ? 'local Supabase web gate not configured'
        : false,
  },
  async (testContext) => {
    assertLocalSupabaseTarget({ databaseUrl, target, confirmation });
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 6 });
    const maintenance = await pool.connect();
    const createdUserIds = [];
    const stamp = `${Date.now()}-${process.pid}`;
    const password = 'WebBoundary123';
    const provider = new SupabaseServerAuthProvider({ authUrl, publishableKey, serviceRoleKey });
    const registry = new AppRegistry();
    registry.register(referenceAppManifest);
    const facade = new ReferenceAppServer({
      authService: new AuthService(provider, registry, {
        allowedRecoveryRedirects: [recoveryRedirect],
      }),
      sessionRunner: new PostgresAuthenticatedSessionRunner(pool),
      recoveryRedirectUrl: recoveryRedirect,
    });
    const application = await createReferenceAppHttpServer({
      facade,
      allowedOrigin: origin,
      secureCookies: false,
    });
    let cookieA;
    let cookieB;
    let projectId;

    try {
      await assertNativeSupabaseContract(maintenance);

      await testContext.test('signup sets protected cookies without returning tokens', async () => {
        const ownerA = await application.inject(
          post('/api/auth/sign-up', {
            email: `web-owner-a-${stamp}@example.test`,
            password,
          }),
        );
        const ownerB = await application.inject(
          post('/api/auth/sign-up', {
            email: `web-owner-b-${stamp}@example.test`,
            password,
          }),
        );
        assert.equal(ownerA.statusCode, 200);
        assert.equal(ownerB.statusCode, 200);
        assert.doesNotMatch(ownerA.body, /access_token|refresh_token|service.role/i);
        createdUserIds.push(ownerA.json().user.id, ownerB.json().user.id);
        cookieA = cookieHeader(ownerA);
        cookieB = cookieHeader(ownerB);
        assert.match(String(ownerA.headers['set-cookie']), /HttpOnly/i);
        assert.match(String(ownerA.headers['set-cookie']), /SameSite=Lax/i);
      });

      await testContext.test('owner profile update remains inside the cookie session', async () => {
        const updated = await application.inject({
          method: 'PATCH',
          url: '/api/me',
          headers: { origin, 'content-type': 'application/json', cookie: cookieA },
          payload: {
            displayName: 'Web Owner A',
            preferredLanguage: 'pt',
            preferredLocale: 'pt-BR',
            timezone: 'America/Sao_Paulo',
          },
        });
        assert.equal(updated.statusCode, 200);
        assert.equal(updated.json().profile.displayName, 'Web Owner A');
      });

      await testContext.test('project scope cannot be supplied by browser payload', async () => {
        const created = await application.inject(
          post('/api/projects', { name: 'Native HTTP project', metadata: { gate: 'web' } }, cookieA),
        );
        assert.equal(created.statusCode, 201);
        projectId = created.json().project.id;
        assert.equal(created.json().project.ownerUserId, createdUserIds[0]);
        assert.equal(created.json().project.appId, '00000000-0000-4000-8000-000000000001');

        const forged = await application.inject(
          post(
            '/api/projects',
            {
              name: 'Forged project',
              ownerUserId: createdUserIds[1],
              appId: '00000000-0000-4000-8000-000000000999',
            },
            cookieA,
          ),
        );
        assert.equal(forged.statusCode, 400);
        assert.equal(forged.json().error.code, 'INVALID_PROJECT_INPUT');
      });

      await testContext.test('audit endpoint is tenant-scoped and excludes private payloads', async () => {
        const ownerAudit = await application.inject({
          method: 'GET',
          url: '/api/audit',
          headers: { cookie: cookieA },
        });
        assert.equal(ownerAudit.statusCode, 200);
        const projectEvents = ownerAudit.json().events.filter((event) => event.projectId === projectId);
        assert.deepEqual(projectEvents.map((event) => event.eventCode), ['PROJECT_CREATED']);
        assert.doesNotMatch(
          JSON.stringify(projectEvents),
          /Native HTTP project|gate|password|token|cookie|payload/i,
        );

        const otherOwnerAudit = await application.inject({
          method: 'GET',
          url: '/api/audit',
          headers: { cookie: cookieB },
        });
        assert.equal(otherOwnerAudit.statusCode, 200);
        assert.equal(
          otherOwnerAudit.json().events.filter((event) => event.projectId === projectId).length,
          0,
        );
      });

      await testContext.test('same-app cross-user access is hidden by service and RLS', async () => {
        const listB = await application.inject({
          method: 'GET',
          url: '/api/projects',
          headers: { cookie: cookieB },
        });
        assert.equal(listB.statusCode, 200);
        assert.deepEqual(listB.json().projects, []);

        const getB = await application.inject({
          method: 'GET',
          url: `/api/projects/${projectId}`,
          headers: { cookie: cookieB },
        });
        assert.equal(getB.statusCode, 404);
        assert.equal(getB.json().error.code, 'PROJECT_NOT_FOUND');
      });

      await testContext.test('workspace selection isolates projects and rejects foreign selection', async () => {
        const personal = await application.inject({
          method: 'GET',
          url: '/api/workspaces',
          headers: { cookie: cookieA },
        });
        assert.equal(personal.statusCode, 200);
        assert.equal(personal.json().workspaces.length, 1);
        const personalId = personal.json().activeWorkspaceId;

        const createdWorkspace = await application.inject(
          post('/api/workspaces', { name: 'HTTP Shared Workspace' }, cookieA),
        );
        assert.equal(createdWorkspace.statusCode, 201);
        const sharedId = createdWorkspace.json().workspace.id;
        assert.notEqual(sharedId, personalId);
        const sharedCookie = mergeCookieHeader(cookieA, createdWorkspace);

        const sharedProject = await application.inject(
          post('/api/projects', { name: 'Shared HTTP project' }, sharedCookie),
        );
        assert.equal(sharedProject.statusCode, 201);
        assert.equal(sharedProject.json().project.organizationId, sharedId);

        const personalProjects = await application.inject({
          method: 'GET',
          url: '/api/projects',
          headers: { cookie: cookieA },
        });
        assert.deepEqual(personalProjects.json().projects.map((project) => project.id), [projectId]);

        const sharedProjects = await application.inject({
          method: 'GET',
          url: '/api/projects',
          headers: { cookie: sharedCookie },
        });
        assert.deepEqual(sharedProjects.json().projects.map((project) => project.id), [
          sharedProject.json().project.id,
        ]);

        const foreignSelection = await application.inject(
          post('/api/workspaces/select', { organizationId: sharedId }, cookieB),
        );
        assert.equal(foreignSelection.statusCode, 403);
        assert.equal(foreignSelection.json().error.code, 'WORKSPACE_ACCESS_DENIED');
      });

      await testContext.test('cross-origin writes are rejected before reaching services', async () => {
        const response = await application.inject({
          ...post('/api/projects', { name: 'Cross-origin project' }, cookieA),
          headers: {
            origin: 'http://evil.example',
            'content-type': 'application/json',
            cookie: cookieA,
          },
        });
        assert.equal(response.statusCode, 400);
        assert.equal(response.json().error.code, 'INVALID_AUTH_INPUT');
      });

      await testContext.test('archive, soft-delete and logout preserve HTTP semantics', async () => {
        const archived = await application.inject(
          post(`/api/projects/${projectId}/archive`, {}, cookieA),
        );
        assert.equal(archived.statusCode, 200);
        assert.equal(archived.json().project.status, 'ARCHIVED');

        const deleted = await application.inject(
          post(`/api/projects/${projectId}/delete`, {}, cookieA),
        );
        assert.equal(deleted.statusCode, 204);
        const listA = await application.inject({
          method: 'GET',
          url: '/api/projects',
          headers: { cookie: cookieA },
        });
        assert.deepEqual(listA.json().projects, []);

        const audit = await application.inject({
          method: 'GET',
          url: '/api/audit',
          headers: { cookie: cookieA },
        });
        assert.deepEqual(
          audit.json().events
            .filter((event) => event.projectId === projectId)
            .map((event) => event.eventCode)
            .sort(),
          ['PROJECT_ARCHIVED', 'PROJECT_CREATED', 'PROJECT_DELETION_REQUESTED'],
        );

        const signedOut = await application.inject(post('/api/auth/sign-out', {}, cookieB));
        assert.equal(signedOut.statusCode, 204);
        assert.match(String(signedOut.headers['set-cookie']), /Max-Age=0|Expires=/i);
      });
    } finally {
      await application.close();
      await maintenance.query('RESET ROLE').catch(() => undefined);
      if (createdUserIds.length > 0) {
        await cleanupGreenHiveUsers(maintenance, createdUserIds).catch(() => undefined);
      }
      maintenance.release();
      await pool.end();
    }
  },
);
