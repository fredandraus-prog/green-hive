import assert from 'node:assert/strict';
import test from 'node:test';
import { BillingError } from '../../packages/billing/dist/index.js';
import {
  createReferenceAppHttpServer,
  REFERENCE_APP_COOKIE_NAMES,
} from '../../apps/hive-reference-app/dist/index.js';

const ORIGIN = 'http://127.0.0.1:3000';
const USER_ID = '10000000-0000-4000-8000-000000000501';
const PROJECT_ID = '20000000-0000-4000-8000-000000000501';
const ORGANIZATION_ID = '30000000-0000-4000-8000-000000000501';

function session() {
  return {
    accessToken: 'access-token-that-is-long-enough-for-http',
    refreshToken: 'refresh-token-that-is-long-enough-for-http',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    user: { id: USER_ID, email: 'web@example.test', appCode: 'REFERENCE_APP' },
  };
}

function profile() {
  return {
    userId: USER_ID,
    displayName: 'Web Owner',
    preferredLanguage: 'pt',
    preferredLocale: 'pt-BR',
    timezone: 'America/Sao_Paulo',
    preferences: {},
    createdAt: new Date('2026-08-18T00:00:00.000Z'),
    updatedAt: new Date('2026-08-18T00:00:00.000Z'),
  };
}

function project() {
  return {
    id: PROJECT_ID,
    organizationId: ORGANIZATION_ID,
    appId: '00000000-0000-4000-8000-000000000001',
    ownerUserId: USER_ID,
    name: 'HTTP project',
    status: 'DRAFT',
    metadata: {},
    archivedAt: null,
    deletedAt: null,
    createdAt: new Date('2026-08-18T00:00:00.000Z'),
    updatedAt: new Date('2026-08-18T00:00:00.000Z'),
  };
}

function workspace() {
  return {
    id: ORGANIZATION_ID,
    name: 'Personal Workspace',
    slug: 'personal-00000000000000000000000000000501',
    kind: 'PERSONAL',
    status: 'ACTIVE',
    role: 'OWNER',
    appRelationship: 'NATIVE',
    createdAt: new Date('2026-08-20T00:00:00.000Z'),
    updatedAt: new Date('2026-08-20T00:00:00.000Z'),
  };
}

function auditEvent() {
  return {
    id: '40000000-0000-4000-8000-000000000501',
    eventCode: 'PROJECT_CREATED',
    actorUserId: USER_ID,
    actorType: 'USER',
    organizationId: ORGANIZATION_ID,
    appId: '00000000-0000-4000-8000-000000000001',
    projectId: PROJECT_ID,
    subjectType: 'PROJECT',
    subjectId: PROJECT_ID,
    outcome: 'SUCCEEDED',
    requestId: '50000000-0000-4000-8000-000000000501',
    correlationId: '50000000-0000-4000-8000-000000000501',
    metadata: { status: 'DRAFT' },
    occurredAt: new Date('2026-08-20T12:00:00.000Z'),
  };
}

class FakeFacade {
  calls = [];

  async signUp(input) { this.calls.push(['signUp', input]); return session(); }
  async signIn(input) { this.calls.push(['signIn', input]); return session(); }
  async refreshSession(input) { this.calls.push(['refreshSession', input]); return session(); }
  async signOut(input) { this.calls.push(['signOut', input]); }
  async requestPasswordRecovery(input) {
    this.calls.push(['requestPasswordRecovery', input]);
    return { state: 'opaque_recovery_state_that_is_long_enough' };
  }
  async exchangePasswordRecoveryCode(input) {
    this.calls.push(['exchangePasswordRecoveryCode', input]);
    return session();
  }
  async completePasswordRecovery(input) { this.calls.push(['completePasswordRecovery', input]); }
  async getMe(token) { this.calls.push(['getMe', token]); return profile(); }
  async getAccount(token) { this.calls.push(['getAccount', token]); return { email: session().user.email, profile: profile() }; }
  async updateMe(token, input) { this.calls.push(['updateMe', token, input]); return { ...profile(), ...input }; }
  async listWorkspaces(token) { this.calls.push(['listWorkspaces', token]); return [workspace()]; }
  async createSharedWorkspace(token, input) { this.calls.push(['createSharedWorkspace', token, input]); return { ...workspace(), kind: 'SHARED', name: input.name }; }
  async renameWorkspace(token, organizationId, input) { this.calls.push(['renameWorkspace', token, organizationId, input]); return { ...workspace(), id: organizationId, kind: 'SHARED', name: input.name }; }
  async listWorkspaceMembers(token, organizationId) { this.calls.push(['listWorkspaceMembers', token, organizationId]); return []; }
  async addWorkspaceMember(token, organizationId, input) { this.calls.push(['addWorkspaceMember', token, organizationId, input]); return { organizationId, ...input, status: 'ACTIVE', joinedAt: new Date(), updatedAt: new Date() }; }
  async listAuditEvents(token, organizationId) { this.calls.push(['listAuditEvents', token, organizationId]); return [auditEvent()]; }
  async createProject(token, organizationId, input) { this.calls.push(['createProject', token, organizationId, input]); return { ...project(), ...input }; }
  async listProjects(token, organizationId) { this.calls.push(['listProjects', token, organizationId]); return [project()]; }
  async getProject(token, organizationId, id) { this.calls.push(['getProject', token, organizationId, id]); return project(); }
  async archiveProject(token, organizationId, id) { this.calls.push(['archiveProject', token, organizationId, id]); return { ...project(), status: 'ARCHIVED' }; }
  async softDeleteProject(token, organizationId, id) { this.calls.push(['softDeleteProject', token, organizationId, id]); }
  async canProjectCapability(token, organizationId, id, capabilityCode) {
    this.calls.push(['canProjectCapability', token, organizationId, id, capabilityCode]);
    return capabilityCode === 'REFERENCE_APP_RUN_JOB';
  }
}

test('audit endpoint derives workspace scope from the protected cookie', async () => {
  const facade = new FakeFacade();
  const application = await createReferenceAppHttpServer({
    facade,
    allowedOrigin: ORIGIN,
    secureCookies: false,
  });
  try {
    const signedIn = await application.inject(
      postOptions('/api/auth/sign-in', { email: 'web@example.test', password: 'StrongPass123' }),
    );
    const response = await application.inject({
      method: 'GET',
      url: '/api/audit',
      headers: { cookie: cookieHeader(signedIn) },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().events[0].eventCode, 'PROJECT_CREATED');
    assert.deepEqual(facade.calls.at(-1), [
      'listAuditEvents',
      'access-token-that-is-long-enough-for-http',
      ORGANIZATION_ID,
    ]);
  } finally {
    await application.close();
  }
});

function cookieHeader(response) {
  const values = response.headers['set-cookie'];
  return (Array.isArray(values) ? values : [values])
    .filter(Boolean)
    .map((value) => value.split(';', 1)[0])
    .join('; ');
}

function postOptions(url, payload, cookie) {
  return {
    method: 'POST',
    url,
    headers: {
      origin: ORIGIN,
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    payload,
  };
}

test('HTTP boundary keeps sessions in HttpOnly same-site cookies', async () => {
  const facade = new FakeFacade();
  const application = await createReferenceAppHttpServer({
    facade,
    allowedOrigin: ORIGIN,
    secureCookies: false,
  });
  try {
    const onboarding = {
      displayName: 'Web Owner',
      email: 'web@example.test',
      password: 'StrongPass123',
      preferredLanguage: 'pt',
      preferredLocale: 'pt-BR',
      timezone: 'America/Sao_Paulo',
      organizationName: 'Minha Empresa',
    };
    const response = await application.inject(postOptions('/api/auth/sign-up', onboarding));
    assert.equal(response.statusCode, 200);
    const setCookies = response.headers['set-cookie'];
    assert.ok(Array.isArray(setCookies));
    assert.equal(setCookies.length, 3);
    assert.ok(setCookies.some((value) => value.startsWith(`${REFERENCE_APP_COOKIE_NAMES.access}=`)));
    assert.ok(setCookies.some((value) => value.startsWith(`${REFERENCE_APP_COOKIE_NAMES.refresh}=`)));
    assert.ok(setCookies.some((value) => value.startsWith(`${REFERENCE_APP_COOKIE_NAMES.workspace}=`)));
    assert.ok(setCookies.every((value) => /HttpOnly/i.test(value) && /SameSite=Lax/i.test(value)));
    assert.doesNotMatch(response.body, /access-token|refresh-token|service.role/i);
    assert.deepEqual(facade.calls[0], ['signUp', onboarding]);

    const me = await application.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: cookieHeader(response) },
    });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().profile.userId, USER_ID);
    assert.equal(me.json().email, 'web@example.test');
    assert.equal(me.headers['cache-control'], 'private, no-store');
  } finally {
    await application.close();
  }
});

test('current workspace rename uses the server-validated workspace cookie', async () => {
  const facade = new FakeFacade();
  const application = await createReferenceAppHttpServer({ facade, allowedOrigin: ORIGIN, secureCookies: false });
  try {
    const signedIn = await application.inject(
      postOptions('/api/auth/sign-in', { email: 'web@example.test', password: 'StrongPass123' }),
    );
    const renamed = await application.inject({
      method: 'PATCH',
      url: '/api/workspaces/current',
      headers: {
        origin: ORIGIN,
        'content-type': 'application/json',
        cookie: cookieHeader(signedIn),
      },
      payload: { name: 'Equipe Green' },
    });
    assert.equal(renamed.statusCode, 200);
    assert.deepEqual(facade.calls.at(-1), [
      'renameWorkspace',
      session().accessToken,
      ORGANIZATION_ID,
      { name: 'Equipe Green' },
    ]);
  } finally {
    await application.close();
  }
});

test('hosted health contract reports readiness without exposing failures', async () => {
  let ready = false;
  const application = await createReferenceAppHttpServer({
    facade: new FakeFacade(),
    allowedOrigin: 'https://green-hive-staging.onrender.com',
    secureCookies: true,
    readinessCheck: async () => {
      if (!ready) throw new Error('database details must remain private');
    },
  });
  try {
    const live = await application.inject({ method: 'GET', url: '/api/health' });
    assert.equal(live.statusCode, 200);
    assert.equal(live.headers['strict-transport-security'], 'max-age=31536000; includeSubDomains');
    assert.equal(live.headers['cross-origin-resource-policy'], 'same-origin');
    assert.equal(live.headers['x-dns-prefetch-control'], 'off');
    assert.equal(live.headers['x-permitted-cross-domain-policies'], 'none');
    assert.match(live.headers['content-security-policy'], /object-src 'none'/);

    const signedIn = await application.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      headers: {
        origin: 'https://green-hive-staging.onrender.com',
        'content-type': 'application/json',
      },
      payload: { email: 'web@example.test', password: 'StrongPass123' },
    });
    assert.ok(
      signedIn.headers['set-cookie'].every((value) => /HttpOnly/i.test(value) && /Secure/i.test(value)),
    );

    const unavailable = await application.inject({ method: 'GET', url: '/api/ready' });
    assert.equal(unavailable.statusCode, 503);
    assert.deepEqual(unavailable.json(), { status: 'not_ready', app: 'REFERENCE_APP' });
    assert.doesNotMatch(unavailable.body, /database details/);

    ready = true;
    const available = await application.inject({ method: 'GET', url: '/api/ready' });
    assert.equal(available.statusCode, 200);
    assert.deepEqual(available.json(), { status: 'ready', app: 'REFERENCE_APP' });
    assert.equal(available.headers['ratelimit-limit'], undefined);
  } finally {
    await application.close();
  }
});

test('HTTP boundary rejects cross-origin mutations and forged scope fields', async () => {
  const application = await createReferenceAppHttpServer({
    facade: new FakeFacade(),
    allowedOrigin: ORIGIN,
    secureCookies: false,
  });
  try {
    const noOrigin = await application.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'web@example.test', password: 'StrongPass123' },
    });
    assert.equal(noOrigin.statusCode, 400);
    assert.equal(noOrigin.json().error.code, 'INVALID_AUTH_INPUT');

    const forged = await application.inject(
      postOptions('/api/auth/sign-up', {
        email: 'web@example.test',
        password: 'StrongPass123',
        appCode: 'OTHER_TEST_APP',
      }),
    );
    assert.equal(forged.statusCode, 400);
    assert.equal(forged.json().error.code, 'INVALID_AUTH_INPUT');

    const wrongOrigin = await application.inject({
      ...postOptions('/api/auth/sign-in', {
        email: 'web@example.test',
        password: 'StrongPass123',
      }),
      headers: { origin: 'http://evil.example', 'content-type': 'application/json' },
    });
    assert.equal(wrongOrigin.statusCode, 400);
  } finally {
    await application.close();
  }
});

test('PKCE recovery state never enters JSON and is consumed from an HttpOnly cookie', async () => {
  const facade = new FakeFacade();
  const application = await createReferenceAppHttpServer({
    facade,
    allowedOrigin: ORIGIN,
    secureCookies: false,
  });
  try {
    const requested = await application.inject(
      postOptions('/api/auth/recovery', { email: 'web@example.test' }),
    );
    assert.equal(requested.statusCode, 200);
    assert.deepEqual(requested.json(), { accepted: true });
    assert.doesNotMatch(requested.body, /opaque_recovery_state/);
    const recoveryCookie = cookieHeader(requested);
    assert.match(recoveryCookie, new RegExp(`^${REFERENCE_APP_COOKIE_NAMES.recovery}=`));
    assert.match(String(requested.headers['set-cookie']), /HttpOnly/i);

    const exchanged = await application.inject(
      postOptions(
        '/api/auth/recovery/exchange',
        {
          code: '12345678-1234-4234-8234-123456789abc',
          flowId: '0123456789abcdef0123456789abcdef',
        },
        recoveryCookie,
      ),
    );
    assert.equal(exchanged.statusCode, 200);
    assert.equal(exchanged.json().ready, true);
    assert.deepEqual(facade.calls.at(-1), [
      'exchangePasswordRecoveryCode',
      {
        code: '12345678-1234-4234-8234-123456789abc',
        state: 'opaque_recovery_state_that_is_long_enough',
        flowId: '0123456789abcdef0123456789abcdef',
      },
    ]);
    assert.doesNotMatch(exchanged.body, /access-token|refresh-token|opaque_recovery_state/);
  } finally {
    await application.close();
  }
});

test('project routes derive owner and app only from the verified cookie session', async () => {
  const facade = new FakeFacade();
  const application = await createReferenceAppHttpServer({
    facade,
    allowedOrigin: ORIGIN,
    secureCookies: false,
  });
  try {
    const signedIn = await application.inject(
      postOptions('/api/auth/sign-in', { email: 'web@example.test', password: 'StrongPass123' }),
    );
    const cookie = cookieHeader(signedIn);
    const created = await application.inject(
      postOptions('/api/projects', { name: 'HTTP project', metadata: { source: 'web' } }, cookie),
    );
    assert.equal(created.statusCode, 201);
    assert.deepEqual(facade.calls.at(-1), [
      'createProject',
      session().accessToken,
      ORGANIZATION_ID,
      { name: 'HTTP project', metadata: { source: 'web' } },
    ]);

    const forged = await application.inject(
      postOptions(
        '/api/projects',
        { name: 'Forged project', ownerUserId: USER_ID, appId: 'other' },
        cookie,
      ),
    );
    assert.equal(forged.statusCode, 400);
    assert.equal(forged.json().error.code, 'INVALID_PROJECT_INPUT');
  } finally {
    await application.close();
  }
});

test('capability decisions derive project and workspace scope from the verified session', async () => {
  const facade = new FakeFacade();
  const application = await createReferenceAppHttpServer({
    facade,
    allowedOrigin: ORIGIN,
    secureCookies: false,
  });
  try {
    const signedIn = await application.inject(
      postOptions('/api/auth/sign-in', { email: 'web@example.test', password: 'StrongPass123' }),
    );
    const cookie = cookieHeader(signedIn);
    const allowed = await application.inject({
      method: 'GET',
      url: `/api/projects/${PROJECT_ID}/capabilities/REFERENCE_APP_RUN_JOB`,
      headers: { cookie },
    });
    assert.equal(allowed.statusCode, 200);
    assert.deepEqual(allowed.json(), { allowed: true });
    assert.deepEqual(facade.calls.at(-1), [
      'canProjectCapability',
      session().accessToken,
      ORGANIZATION_ID,
      PROJECT_ID,
      'REFERENCE_APP_RUN_JOB',
    ]);

    const invalid = await application.inject({
      method: 'GET',
      url: `/api/projects/${PROJECT_ID}/capabilities/not-valid`,
      headers: { cookie },
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error.code, 'INVALID_ENTITLEMENT_INPUT');
  } finally {
    await application.close();
  }
});

test('payment webhook accepts a provider-signed raw body without browser Origin trust', async () => {
  const calls = [];
  const billingWebhookService = {
    async process(providerCode, request) {
      calls.push({ providerCode, signature: request.signature, rawBody: Buffer.from(request.rawBody) });
      return {
        eventRecordId: '80000000-0000-4000-8000-000000000001',
        providerEventId: 'evt_http_0001',
        purchaseId: '60000000-0000-4000-8000-000000000001',
        paymentId: '70000000-0000-4000-8000-000000000001',
        effect: 'PAYMENT_CONFIRMED',
        duplicate: false,
        deliveryCount: 1,
      };
    },
  };
  const application = await createReferenceAppHttpServer({
    facade: new FakeFacade(),
    allowedOrigin: ORIGIN,
    secureCookies: false,
    billingWebhookService,
  });
  try {
    const rawPayload = '{"eventId":"evt_http_0001", "type":"PAYMENT_PAID"}';
    const accepted = await application.inject({
      method: 'POST',
      url: '/api/webhooks/payments/GREEN_HIVE_FAKE',
      headers: {
        'content-type': 'application/json',
        'x-green-hive-signature': `t=1800000000,v1=${'a'.repeat(64)}`,
      },
      payload: rawPayload,
    });
    assert.equal(accepted.statusCode, 202);
    assert.deepEqual(accepted.json(), { status: 'accepted', duplicate: false });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].providerCode, 'GREEN_HIVE_FAKE');
    assert.equal(calls[0].rawBody.toString('utf8'), rawPayload);

    const unsigned = await application.inject({
      method: 'POST',
      url: '/api/webhooks/payments/GREEN_HIVE_FAKE',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    assert.equal(unsigned.statusCode, 401);
    assert.equal(unsigned.json().error.code, 'BILLING_WEBHOOK_SIGNATURE_INVALID');

    billingWebhookService.process = async () => {
      throw new BillingError('BILLING_WEBHOOK_PROCESSING_FAILED');
    };
    const unavailable = await application.inject({
      method: 'POST',
      url: '/api/webhooks/payments/GREEN_HIVE_FAKE',
      headers: {
        'content-type': 'application/json',
        'x-green-hive-signature': `t=1800000000,v1=${'b'.repeat(64)}`,
      },
      payload: '{}',
    });
    assert.equal(unavailable.statusCode, 503);
    assert.deepEqual(unavailable.json(), {
      error: {
        code: 'BILLING_WEBHOOK_PROCESSING_FAILED',
        category: 'UNAVAILABLE',
        status: 503,
        retryable: true,
        message: 'Request could not be completed.',
      },
    });
  } finally {
    await application.close();
  }
});

test('HTTP boundary replaces unexpected implementation failures with the stable internal contract', async () => {
  const facade = new FakeFacade();
  facade.signIn = async () => {
    throw new Error('SQLSTATE 23505 provider_secret=not-for-client stack trace');
  };
  const application = await createReferenceAppHttpServer({ facade, allowedOrigin: ORIGIN, secureCookies: false });
  try {
    const response = await application.inject(
      postOptions('/api/auth/sign-in', { email: 'web@example.test', password: 'StrongPass123' }),
    );
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), {
      error: {
        code: 'INTERNAL_ERROR',
        category: 'INTERNAL',
        status: 500,
        retryable: true,
        message: 'Request could not be completed.',
      },
    });
    assert.doesNotMatch(response.body, /SQLSTATE|provider_secret|stack trace/i);
  } finally {
    await application.close();
  }
});
