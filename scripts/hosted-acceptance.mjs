import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import http from 'node:http';
import pg from 'pg';
import { GoTrueClient } from '@supabase/supabase-js';
import { cleanupGreenHiveUserData } from './lib/local-supabase-guard.mjs';
import { stagingConfigurationFromEnvironment } from './lib/staging-guard.mjs';

const EXPECTED_ORIGIN = 'https://green-hive-staging.onrender.com';
const EXPECTED_CONFIRMATION = 'CREATE_DISPOSABLE_HOSTED_FIXTURES';
const RECOVERY_WAIT_MS = 5 * 60 * 1000;
const MAX_RECOVERY_LINK_BYTES = 8 * 1024;

const originValue = process.env.GREEN_HIVE_HOSTED_APP_ORIGIN?.trim();
const confirmation = process.env.GREEN_HIVE_HOSTED_TEST_CONFIRM?.trim();
const databaseUrl = process.env.GREEN_HIVE_TEST_DATABASE_URL?.trim();
const authUrl = process.env.GREEN_HIVE_SUPABASE_AUTH_URL?.trim();
const serviceRoleKey = process.env.GREEN_HIVE_SUPABASE_SERVICE_ROLE_KEY?.trim();
const webhookSecretValue = process.env.GREEN_HIVE_FAKE_WEBHOOK_SECRET?.trim();

if (originValue !== EXPECTED_ORIGIN) {
  throw new Error(`GREEN_HIVE_HOSTED_APP_ORIGIN must be exactly ${EXPECTED_ORIGIN}`);
}
if (confirmation !== EXPECTED_CONFIRMATION) {
  throw new Error(
    `GREEN_HIVE_HOSTED_TEST_CONFIRM must be exactly ${EXPECTED_CONFIRMATION}`,
  );
}
if (
  !databaseUrl ||
  !authUrl ||
  !serviceRoleKey ||
  !webhookSecretValue ||
  !/^[A-Za-z0-9_-]{43,86}$/.test(webhookSecretValue)
) {
  throw new Error('Guarded database and Auth Admin cleanup settings are required');
}
const webhookSecret = Buffer.from(webhookSecretValue, 'base64url');
if (webhookSecret.byteLength < 32 || webhookSecret.byteLength > 64) {
  throw new Error('Guarded hosted webhook secret is invalid');
}

const staging = stagingConfigurationFromEnvironment();
const origin = new URL(originValue);
const stamp = `${Date.now()}-${process.pid}`;
const originalPassword = `HostedBoundary-${stamp}-Aa1!`;
const recoveredPassword = `HostedRecovered-${stamp}-Bb2!`;
const fixtureEmails = Object.freeze([
  `hosted-acceptance-owner-a-${stamp}@example.test`,
  `hosted-acceptance-owner-b-${stamp}@example.test`,
  `hosted-acceptance-recovery-${stamp}@example.test`,
]);
const fixtureUserIds = new Set();
const fixtureOrganizationIds = new Set();
const fixtureProjectIds = new Set();
const fixtureProviderEventIds = new Set();

class CookieJar {
  #cookies;

  constructor(entries = []) {
    this.#cookies = new Map(entries);
  }

  clone() {
    return new CookieJar(this.#cookies.entries());
  }

  header() {
    return [...this.#cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  absorb(response) {
    const values = response.headers.getSetCookie?.() ?? [];
    for (const value of values) {
      const [pair] = value.split(';', 1);
      const separator = pair.indexOf('=');
      if (separator < 1) continue;
      const name = pair.slice(0, separator);
      const cookieValue = pair.slice(separator + 1);
      if (/Max-Age=0/i.test(value) || cookieValue === '') this.#cookies.delete(name);
      else this.#cookies.set(name, cookieValue);
    }
    return values;
  }
}

async function request(
  pathname,
  { method = 'GET', payload, jar, requestOrigin = origin.origin, contentType = true } = {},
) {
  const headers = new Headers();
  if (jar?.header()) headers.set('cookie', jar.header());
  if (method !== 'GET' && method !== 'HEAD') {
    headers.set('origin', requestOrigin);
    if (contentType) headers.set('content-type', 'application/json');
  }
  const response = await fetch(new URL(pathname, origin), {
    method,
    headers,
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  const setCookies = jar?.absorb(response) ?? response.headers.getSetCookie?.() ?? [];
  const bodyText = await response.text();
  let body;
  try {
    body = bodyText ? JSON.parse(bodyText) : undefined;
  } catch {
    body = bodyText;
  }
  return { response, body, bodyText, setCookies };
}

async function createPendingPurchase(projectId, userId, organizationId) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(
      `SELECT
         set_config('request.jwt.claims', $1, true),
         set_config('request.green_hive.organization_id', $2, true)`,
      [
        JSON.stringify({
          sub: userId,
          app_metadata: { app_code: 'REFERENCE_APP', platform_role: 'USER' },
        }),
        organizationId,
      ],
    );
    const created = await client.query(
      `SELECT hive.create_pending_purchase(
         $1::uuid,
         'REFERENCE_APP_SANDBOX',
         '50000000-0000-4000-8000-000000000001'::uuid,
         $2::text
       )::text AS purchase_id`,
      [projectId, `hosted-webhook-${stamp}`],
    );
    await client.query('COMMIT');
    return created.rows[0].purchase_id;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function deliverPaymentWebhook(payload, { validSignature = true } = {}) {
  const rawBody = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', webhookSecret)
    .update(Buffer.from(`${timestamp}.`, 'utf8'))
    .update(Buffer.from(rawBody, 'utf8'))
    .digest('hex');
  const response = await fetch(
    new URL('/api/webhooks/payments/GREEN_HIVE_FAKE', origin),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-green-hive-signature': `t=${timestamp},v1=${validSignature ? digest : '0'.repeat(64)}`,
      },
      body: rawBody,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    },
  );
  const bodyText = await response.text();
  return { response, body: bodyText ? JSON.parse(bodyText) : undefined, bodyText };
}

async function assertWebhookEvidence(purchaseId, providerEventId) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const evidence = await client.query(
      `SELECT
         purchase.status AS purchase_status,
         payment.status AS payment_status,
         provider_event.delivery_count,
         provider_event.effect,
         count(audit_event.id)::integer AS audit_count
       FROM hive.purchases AS purchase
       JOIN hive.payments AS payment ON payment.purchase_id = purchase.id
       JOIN hive.payment_provider_events AS provider_event
         ON provider_event.payment_id = payment.id
        AND provider_event.provider_event_id = $2::text
       LEFT JOIN audit.events AS audit_event
         ON audit_event.subject_id = payment.id
        AND audit_event.event_code = 'PAYMENT_CONFIRMED'
       WHERE purchase.id = $1::uuid
       GROUP BY
         purchase.status,
         payment.status,
         provider_event.delivery_count,
         provider_event.effect`,
      [purchaseId, providerEventId],
    );
    assert.deepEqual(evidence.rows, [{
      purchase_status: 'CONFIRMED',
      payment_status: 'PAID',
      delivery_count: 2,
      effect: 'PAYMENT_CONFIRMED',
      audit_count: 1,
    }]);
  } finally {
    await client.end();
  }
}

function assertSafeError(result, status, code) {
  assert.equal(result.response.status, status);
  assert.equal(result.body?.error?.code, code);
  assert.doesNotMatch(result.bodyText, /postgres|supabase|sql|stack|service.role/i);
}

function assertProtectedSessionCookies(setCookies) {
  assert.equal(setCookies.length, 3);
  assert.ok(
    setCookies.every(
      (value) =>
        /HttpOnly/i.test(value) &&
        /Secure/i.test(value) &&
        /SameSite=Lax/i.test(value) &&
        !/Domain=/i.test(value),
    ),
  );
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

async function waitForRecoveryLink(email) {
  const bridgeToken = randomUUID();
  let timeout;
  let settled = false;
  let resolver;
  let rejecter;
  const linkPromise = new Promise((resolve, reject) => {
    resolver = resolve;
    rejecter = reject;
  });

  const server = http.createServer((incoming, response) => {
    if (incoming.method !== 'POST' || incoming.url !== `/recovery-link/${bridgeToken}`) {
      response.writeHead(404).end();
      return;
    }
    let bytes = 0;
    const chunks = [];
    incoming.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_RECOVERY_LINK_BYTES) incoming.destroy();
      else chunks.push(chunk);
    });
    incoming.on('end', () => {
      if (settled) {
        response.writeHead(409).end();
        return;
      }
      try {
        const candidate = new URL(Buffer.concat(chunks).toString('utf8').trim());
        if (candidate.protocol !== 'https:' || candidate.hostname !== `${staging.projectRef}.supabase.co`) {
          throw new Error('Recovery link does not belong to the confirmed Supabase staging project');
        }
        settled = true;
        clearTimeout(timeout);
        response.writeHead(204).end();
        resolver(candidate);
      } catch (error) {
        response.writeHead(400).end();
        rejecter(error);
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Recovery bridge did not bind safely');
  timeout = setTimeout(() => {
    if (!settled) rejecter(new Error('Timed out waiting for the Mailtrap recovery link'));
  }, RECOVERY_WAIT_MS);

  console.log(JSON.stringify({
    status: 'WAITING_FOR_MAILTRAP_RECOVERY_LINK',
    recipient: email,
    bridgeUrl: `http://127.0.0.1:${address.port}/recovery-link/${bridgeToken}`,
    timeoutSeconds: RECOVERY_WAIT_MS / 1000,
  }));

  try {
    return await linkPromise;
  } finally {
    clearTimeout(timeout);
    await new Promise((resolve) => server.close(resolve));
  }
}

async function completeRecovery(jar, email) {
  const requested = await request('/api/auth/recovery', {
    method: 'POST',
    payload: { email },
    jar,
  });
  assert.equal(requested.response.status, 200);
  assert.deepEqual(requested.body, { accepted: true });
  assert.equal(requested.setCookies.length, 1);
  assert.match(requested.setCookies[0], /HttpOnly/i);
  assert.match(requested.setCookies[0], /Secure/i);
  assert.doesNotMatch(requested.bodyText, /state|token|code/i);

  const recoveryUrl = await waitForRecoveryLink(email);
  const verification = await fetch(recoveryUrl, {
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok([302, 303].includes(verification.status));
  const location = verification.headers.get('location');
  assert.ok(location, 'Recovery verification must redirect to the application callback');
  const callback = new URL(location);
  assert.equal(`${callback.origin}${callback.pathname}`, `${origin.origin}/auth/recovery`);
  assert.equal(callback.hash, '');
  const code = callback.searchParams.get('code');
  const flowId = callback.searchParams.get('sb_flow_id');
  assert.ok(code, 'Recovery callback must contain the one-time PKCE code');

  const exchange = await request('/api/auth/recovery/exchange', {
    method: 'POST',
    payload: { code, ...(flowId ? { flowId } : {}) },
    jar,
  });
  assert.equal(exchange.response.status, 200);
  assert.deepEqual(exchange.body, { ready: true });
  assert.ok(exchange.setCookies.some((value) => /green_hive_access=/i.test(value)));
  assert.doesNotMatch(exchange.bodyText, /access_token|refresh_token|state|code/i);

  const completed = await request('/api/auth/recovery/complete', {
    method: 'POST',
    payload: { newPassword: recoveredPassword },
    jar,
  });
  assert.equal(completed.response.status, 200);
  assert.deepEqual(completed.body, { updated: true });

  const oldPassword = await request('/api/auth/sign-in', {
    method: 'POST',
    payload: { email, password: originalPassword },
    jar: new CookieJar(),
  });
  assertSafeError(oldPassword, 401, 'AUTH_INVALID_CREDENTIALS');
  const recoveredJar = new CookieJar();
  const newPassword = await request('/api/auth/sign-in', {
    method: 'POST',
    payload: { email, password: recoveredPassword },
    jar: recoveredJar,
  });
  assert.equal(newPassword.response.status, 200);
  assertProtectedSessionCookies(newPassword.setCookies);

  const reused = await request('/api/auth/recovery/exchange', {
    method: 'POST',
    payload: { code, ...(flowId ? { flowId } : {}) },
    jar,
  });
  assertSafeError(reused, 401, 'AUTH_RECOVERY_EXCHANGE_FAILED');
}

async function cleanupFixtures() {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const maintenance = await pool.connect();
  const admin = adminClient();
  try {
    await maintenance.query('RESET ROLE').catch(() => undefined);
    const identities = await maintenance.query(
      `SELECT id::text, email
       FROM auth.users
       WHERE email = ANY($1::text[])
       ORDER BY email`,
      [fixtureEmails],
    );
    const userIds = identities.rows.map((row) => row.id);
    for (const userId of userIds) fixtureUserIds.add(userId);
    await cleanupGreenHiveUserData(maintenance, userIds);
    for (const userId of userIds) {
      const deleted = await admin.admin.deleteUser(userId);
      if (deleted.error) throw deleted.error;
    }
    const remaining = await maintenance.query(
      `SELECT
         (SELECT count(*)::integer
            FROM auth.users
           WHERE email = ANY($1::text[])) AS users,
         (SELECT count(*)::integer
            FROM hive.user_profiles
           WHERE user_id = ANY($2::uuid[])) AS profiles,
         (SELECT count(*)::integer
            FROM hive.projects
           WHERE owner_user_id = ANY($2::uuid[])) AS projects,
         (SELECT count(*)::integer
            FROM hive.organization_members
           WHERE user_id = ANY($2::uuid[])) AS memberships,
         (SELECT count(*)::integer
            FROM hive.organizations
           WHERE created_by_user_id = ANY($2::uuid[])
              OR personal_owner_user_id = ANY($2::uuid[])) AS organizations,
         (SELECT count(*)::integer
             FROM audit.events
            WHERE actor_user_id = ANY($2::uuid[])) AS audit_events,
         (SELECT count(*)::integer
            FROM hive.payment_provider_events
           WHERE provider_event_id = ANY($3::text[])) AS provider_events`,
      [fixtureEmails, userIds, [...fixtureProviderEventIds]],
    );
    assert.ok(
      Object.values(remaining.rows[0] ?? {}).every((count) => count === 0),
      `Hosted disposable artifacts remain after cleanup: ${JSON.stringify(remaining.rows[0])}`,
    );
  } finally {
    maintenance.release();
    await pool.end();
  }
}

async function run() {
  const jarA = new CookieJar();
  const jarB = new CookieJar();
  const jarRecovery = new CookieJar();

  const ready = await request('/api/ready');
  assert.equal(ready.response.status, 200);
  assert.deepEqual(ready.body, { status: 'ready', app: 'REFERENCE_APP' });
  assert.equal(ready.response.headers.get('cache-control'), 'private, no-store');
  assert.equal(
    ready.response.headers.get('strict-transport-security'),
    'max-age=31536000; includeSubDomains',
  );
  assert.equal(ready.response.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(ready.response.headers.get('x-dns-prefetch-control'), 'off');
  assert.equal(ready.response.headers.get('x-permitted-cross-domain-policies'), 'none');
  assert.match(ready.response.headers.get('content-security-policy') ?? '', /object-src 'none'/);
  assert.equal(ready.response.headers.get('ratelimit-limit'), null);

  const forgedSignup = await request('/api/auth/sign-up', {
    method: 'POST',
    payload: {
      email: `hosted-acceptance-forged-${stamp}@example.test`,
      password: originalPassword,
      appCode: 'OTHER_TEST_APP',
    },
  });
  assertSafeError(forgedSignup, 400, 'INVALID_AUTH_INPUT');

  const wrongOrigin = await request('/api/auth/sign-in', {
    method: 'POST',
    payload: { email: fixtureEmails[0], password: originalPassword },
    requestOrigin: 'https://attacker.invalid',
  });
  assertSafeError(wrongOrigin, 400, 'INVALID_AUTH_INPUT');

  const unsigned = await request('/api/projects');
  assertSafeError(unsigned, 401, 'AUTH_SESSION_INVALID');

  for (const [email, jar] of [
    [fixtureEmails[0], jarA],
    [fixtureEmails[1], jarB],
    [fixtureEmails[2], jarRecovery],
  ]) {
    const signup = await request('/api/auth/sign-up', {
      method: 'POST',
      payload: { email, password: originalPassword },
      jar,
    });
    assert.equal(signup.response.status, 200);
    assert.equal(signup.response.headers.get('ratelimit-limit'), '5');
    assertProtectedSessionCookies(signup.setCookies);
    assert.doesNotMatch(signup.bodyText, /access_token|refresh_token|service.role/i);
    fixtureUserIds.add(signup.body.user.id);
  }

  const refreshedA = await request('/api/auth/refresh', {
    method: 'POST',
    payload: {},
    jar: jarA,
  });
  assert.equal(refreshedA.response.status, 200);
  assert.ok(refreshedA.setCookies.length >= 2);
  assert.doesNotMatch(refreshedA.bodyText, /access_token|refresh_token/i);

  const updatedProfile = await request('/api/me', {
    method: 'PATCH',
    payload: {
      displayName: 'Hosted Acceptance Owner A',
      preferredLanguage: 'pt',
      preferredLocale: 'pt-BR',
      timezone: 'America/Sao_Paulo',
    },
    jar: jarA,
  });
  assert.equal(updatedProfile.response.status, 200);
  assert.equal(updatedProfile.body.profile.displayName, 'Hosted Acceptance Owner A');

  const workspacesA = await request('/api/workspaces', { jar: jarA });
  assert.equal(workspacesA.response.status, 200);
  assert.equal(workspacesA.body.workspaces.length, 1);
  const personalWorkspaceId = workspacesA.body.activeWorkspaceId;
  fixtureOrganizationIds.add(personalWorkspaceId);

  const createdProject = await request('/api/projects', {
    method: 'POST',
    payload: { name: 'Hosted acceptance project', metadata: { gate: 'hosted-https' } },
    jar: jarA,
  });
  assert.equal(createdProject.response.status, 201);
  const projectId = createdProject.body.project.id;
  fixtureProjectIds.add(projectId);
  assert.equal(createdProject.body.project.ownerUserId, [...fixtureUserIds][0]);
  assert.equal(createdProject.body.project.organizationId, personalWorkspaceId);

  const purchaseId = await createPendingPurchase(
    projectId,
    createdProject.body.project.ownerUserId,
    personalWorkspaceId,
  );
  const providerEventId = `evt_hosted_${stamp}`;
  fixtureProviderEventIds.add(providerEventId);
  const webhookPayload = {
    eventId: providerEventId,
    type: 'PAYMENT_PAID',
    purchaseId,
    providerPaymentId: `pay_hosted_${stamp}`,
  };
  const invalidWebhook = await deliverPaymentWebhook(webhookPayload, { validSignature: false });
  assertSafeError(invalidWebhook, 401, 'BILLING_WEBHOOK_SIGNATURE_INVALID');
  const acceptedWebhook = await deliverPaymentWebhook(webhookPayload);
  assert.equal(acceptedWebhook.response.status, 202);
  assert.deepEqual(acceptedWebhook.body, { status: 'accepted', duplicate: false });
  const duplicateWebhook = await deliverPaymentWebhook(webhookPayload);
  assert.equal(duplicateWebhook.response.status, 202);
  assert.deepEqual(duplicateWebhook.body, { status: 'accepted', duplicate: true });
  await assertWebhookEvidence(purchaseId, providerEventId);

  const forgedProject = await request('/api/projects', {
    method: 'POST',
    payload: {
      name: 'Forged hosted project',
      ownerUserId: [...fixtureUserIds][1],
      appId: '00000000-0000-4000-8000-000000000999',
    },
    jar: jarA,
  });
  assertSafeError(forgedProject, 400, 'INVALID_PROJECT_INPUT');

  const ownerAudit = await request('/api/audit', { jar: jarA });
  assert.equal(ownerAudit.response.status, 200);
  const projectEvents = ownerAudit.body.events.filter((event) => event.projectId === projectId);
  assert.deepEqual(projectEvents.map((event) => event.eventCode), ['PROJECT_CREATED']);
  assert.doesNotMatch(
    JSON.stringify(projectEvents),
    /Hosted acceptance project|hosted-https|password|token|cookie|payload/i,
  );

  const listB = await request('/api/projects', { jar: jarB });
  assert.equal(listB.response.status, 200);
  assert.deepEqual(listB.body.projects, []);
  const getB = await request(`/api/projects/${projectId}`, { jar: jarB });
  assertSafeError(getB, 404, 'PROJECT_NOT_FOUND');

  const sharedJarA = jarA.clone();
  const createdWorkspace = await request('/api/workspaces', {
    method: 'POST',
    payload: { name: 'Hosted Acceptance Shared Workspace' },
    jar: sharedJarA,
  });
  assert.equal(createdWorkspace.response.status, 201);
  const sharedWorkspaceId = createdWorkspace.body.workspace.id;
  fixtureOrganizationIds.add(sharedWorkspaceId);
  assert.notEqual(sharedWorkspaceId, personalWorkspaceId);

  const sharedProject = await request('/api/projects', {
    method: 'POST',
    payload: { name: 'Hosted shared acceptance project' },
    jar: sharedJarA,
  });
  assert.equal(sharedProject.response.status, 201);
  const sharedProjectId = sharedProject.body.project.id;
  fixtureProjectIds.add(sharedProjectId);
  assert.equal(sharedProject.body.project.organizationId, sharedWorkspaceId);

  const personalProjects = await request('/api/projects', { jar: jarA });
  assert.deepEqual(personalProjects.body.projects.map((project) => project.id), [projectId]);
  const sharedProjects = await request('/api/projects', { jar: sharedJarA });
  assert.deepEqual(sharedProjects.body.projects.map((project) => project.id), [sharedProjectId]);

  const foreignWorkspace = await request('/api/workspaces/select', {
    method: 'POST',
    payload: { organizationId: sharedWorkspaceId },
    jar: jarB,
  });
  assertSafeError(foreignWorkspace, 403, 'WORKSPACE_ACCESS_DENIED');

  const csrfAttempt = await request('/api/projects', {
    method: 'POST',
    payload: { name: 'Cross-origin hosted project' },
    jar: jarA,
    requestOrigin: 'https://attacker.invalid',
  });
  assertSafeError(csrfAttempt, 400, 'INVALID_AUTH_INPUT');

  const archived = await request(`/api/projects/${projectId}/archive`, {
    method: 'POST',
    payload: {},
    jar: jarA,
  });
  assert.equal(archived.response.status, 200);
  assert.equal(archived.body.project.status, 'ARCHIVED');

  const deleted = await request(`/api/projects/${projectId}/delete`, {
    method: 'POST',
    payload: {},
    jar: jarA,
  });
  assert.equal(deleted.response.status, 204);
  const listAfterDelete = await request('/api/projects', { jar: jarA });
  assert.deepEqual(listAfterDelete.body.projects, []);

  const deletedShared = await request(`/api/projects/${sharedProjectId}/delete`, {
    method: 'POST',
    payload: {},
    jar: sharedJarA,
  });
  assert.equal(deletedShared.response.status, 204);

  const lifecycleAudit = await request('/api/audit', { jar: jarA });
  assert.deepEqual(
    lifecycleAudit.body.events
      .filter((event) => event.projectId === projectId)
      .map((event) => event.eventCode)
      .sort(),
    ['PROJECT_ARCHIVED', 'PROJECT_CREATED', 'PROJECT_DELETION_REQUESTED'],
  );

  const otherOwnerAudit = await request('/api/audit', { jar: jarB });
  assert.equal(
    otherOwnerAudit.body.events.filter((event) => fixtureProjectIds.has(event.projectId)).length,
    0,
  );

  await completeRecovery(jarRecovery, fixtureEmails[2]);

  const signedOutB = await request('/api/auth/sign-out', {
    method: 'POST',
    payload: {},
    jar: jarB,
  });
  assert.equal(signedOutB.response.status, 204);
  assert.ok(signedOutB.setCookies.every((value) => /Max-Age=0|Expires=/i.test(value)));
  const afterLogoutB = await request('/api/me', { jar: jarB });
  assertSafeError(afterLogoutB, 401, 'AUTH_SESSION_INVALID');

  return {
    status: 'PUBLIC_HTTPS_ACCEPTANCE_PASS',
    origin: origin.origin,
    checks: {
      readinessAndHttpsHeaders: 'PASS',
      signupAndProtectedCookies: 'PASS',
      refreshAndProfile: 'PASS',
      projectsWorkspacesAndAudit: 'PASS',
      crossUserAndCrossWorkspace: 'PASS',
      forgedScopeAndCsrf: 'PASS',
      logicalDeletion: 'PASS',
      verifiedWebhookSingleEffect: 'PASS',
      passwordRecoveryThroughMailtrap: 'PASS',
      logout: 'PASS',
    },
  };
}

let result;
let failure;
try {
  result = await run();
} catch (error) {
  failure = error;
} finally {
  await cleanupFixtures().catch((error) => {
    failure ??= error;
  });
}

if (failure) {
  console.error(JSON.stringify({
    status: 'PUBLIC_HTTPS_ACCEPTANCE_FAIL',
    message: failure instanceof Error ? failure.message : 'Unknown hosted acceptance failure',
    cleanupAttempted: true,
  }));
  throw failure;
}

console.log(JSON.stringify({ ...result, cleanup: 'PASS' }, null, 2));
