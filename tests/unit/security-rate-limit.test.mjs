import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createReferenceAppHttpServer,
  ReferenceAppRateLimiter,
} from '../../apps/hive-reference-app/dist/index.js';

const ORIGIN = 'http://127.0.0.1:3000';
const USER_ID = '10000000-0000-4000-8000-000000000901';
const ORGANIZATION_ID = '30000000-0000-4000-8000-000000000901';
const TEST_SECRET = new Uint8Array(32).fill(9);

function session() {
  return {
    accessToken: 'security-access-token-long-enough-for-tests',
    refreshToken: 'security-refresh-token-long-enough-for-tests',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    user: { id: USER_ID, email: 'security@example.test', appCode: 'REFERENCE_APP' },
  };
}

function workspace() {
  return {
    id: ORGANIZATION_ID,
    name: 'Security Workspace',
    slug: 'security-workspace',
    kind: 'PERSONAL',
    status: 'ACTIVE',
    role: 'OWNER',
    appRelationship: 'NATIVE',
    createdAt: new Date('2026-08-22T00:00:00.000Z'),
    updatedAt: new Date('2026-08-22T00:00:00.000Z'),
  };
}

class SecurityFacade {
  calls = [];

  async signIn(input) {
    this.calls.push(['signIn', input]);
    return session();
  }

  async listWorkspaces(token) {
    this.calls.push(['listWorkspaces', token]);
    return [workspace()];
  }

  async listAuditEvents(token, organizationId) {
    this.calls.push(['listAuditEvents', token, organizationId]);
    return [];
  }
}

function signInOptions(email, forwardedFor = '203.0.113.10') {
  return {
    method: 'POST',
    url: '/api/auth/sign-in',
    headers: {
      origin: ORIGIN,
      'content-type': 'application/json',
      'x-forwarded-for': forwardedFor,
    },
    payload: { email, password: 'StrongPass123' },
  };
}

function cookieHeader(response) {
  const values = response.headers['set-cookie'];
  return (Array.isArray(values) ? values : [values])
    .filter(Boolean)
    .map((value) => value.split(';', 1)[0])
    .join('; ');
}

test('auth rate limit is account-scoped, normalized and returns a stable 429 contract', async () => {
  let now = Date.parse('2026-08-22T12:00:00.000Z');
  const facade = new SecurityFacade();
  const application = await createReferenceAppHttpServer({
    facade,
    allowedOrigin: ORIGIN,
    secureCookies: false,
    rateLimit: {
      now: () => now,
      secret: TEST_SECRET,
      policies: { AUTH_SIGN_IN: { limit: 2, windowMs: 60_000 } },
    },
  });
  try {
    const first = await application.inject(signInOptions(' Target@Example.Test ', '203.0.113.10'));
    const second = await application.inject(signInOptions('target@example.test', '198.51.100.20'));
    const blocked = await application.inject(signInOptions('TARGET@example.test', '192.0.2.30'));

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(blocked.statusCode, 429);
    assert.deepEqual(blocked.json(), {
      error: {
        code: 'RATE_LIMITED',
        category: 'RATE_LIMITED',
        status: 429,
        retryable: true,
        message: 'Request could not be completed.',
      },
    });
    assert.equal(blocked.headers['ratelimit-limit'], '2');
    assert.equal(blocked.headers['ratelimit-remaining'], '0');
    assert.equal(blocked.headers['ratelimit-reset'], '60');
    assert.equal(blocked.headers['ratelimit-policy'], '2;w=60');
    assert.equal(blocked.headers['retry-after'], '60');
    assert.equal(blocked.headers['cache-control'], 'private, no-store');
    assert.doesNotMatch(blocked.body, /target@example|203\.0\.113|198\.51\.100|192\.0\.2/);
    assert.equal(facade.calls.filter(([name]) => name === 'signIn').length, 2);

    const otherAccount = await application.inject(signInOptions('other@example.test'));
    assert.equal(otherAccount.statusCode, 200);

    now += 60_000;
    const reset = await application.inject(signInOptions('target@example.test'));
    assert.equal(reset.statusCode, 200);
    assert.equal(reset.headers['ratelimit-remaining'], '1');
  } finally {
    await application.close();
  }
});

test('expensive authenticated routes are bounded by the protected session cookie', async () => {
  const facade = new SecurityFacade();
  const application = await createReferenceAppHttpServer({
    facade,
    allowedOrigin: ORIGIN,
    secureCookies: false,
    rateLimit: {
      secret: TEST_SECRET,
      policies: { API_EXPENSIVE: { limit: 2, windowMs: 60_000 } },
    },
  });
  try {
    const signedIn = await application.inject(signInOptions('security@example.test'));
    const cookie = cookieHeader(signedIn);
    const first = await application.inject({
      method: 'GET',
      url: '/api/audit',
      headers: { cookie },
    });
    const second = await application.inject({
      method: 'GET',
      url: '/api/audit',
      headers: { cookie, 'x-forwarded-for': '198.51.100.55' },
    });
    const blocked = await application.inject({
      method: 'GET',
      url: '/api/audit',
      headers: { cookie, 'x-forwarded-for': '192.0.2.55' },
    });

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.json().error.code, 'RATE_LIMITED');
    assert.equal(blocked.headers['ratelimit-limit'], '2');
    assert.equal(facade.calls.filter(([name]) => name === 'listAuditEvents').length, 2);
  } finally {
    await application.close();
  }
});

test('health probes are never rate limited', async () => {
  const application = await createReferenceAppHttpServer({
    facade: new SecurityFacade(),
    allowedOrigin: ORIGIN,
    secureCookies: false,
    readinessCheck: async () => undefined,
    rateLimit: {
      secret: TEST_SECRET,
      policies: { API_STANDARD: { limit: 1, windowMs: 60_000 } },
    },
  });
  try {
    for (let index = 0; index < 5; index += 1) {
      const health = await application.inject({ method: 'GET', url: '/api/health' });
      const ready = await application.inject({ method: 'GET', url: '/api/ready' });
      assert.equal(health.statusCode, 200);
      assert.equal(ready.statusCode, 200);
      assert.equal(health.headers['ratelimit-limit'], undefined);
      assert.equal(ready.headers['ratelimit-limit'], undefined);
    }
  } finally {
    await application.close();
  }
});

test('rate-limit storage is bounded and expired buckets are pruned lazily', () => {
  let now = Date.parse('2026-08-22T12:00:00.000Z');
  const limiter = new ReferenceAppRateLimiter({
    maxBuckets: 4,
    now: () => now,
    secret: TEST_SECRET,
    policies: { AUTH_SIGN_IN: { limit: 5, windowMs: 1_000 } },
  });
  const request = (email) => ({
    routeOptions: { url: '/api/auth/sign-in' },
    method: 'POST',
    body: { email },
    cookies: {},
    headers: {},
    ip: '127.0.0.1',
  });

  assert.equal(limiter.check(request('one@example.test')).allowed, true);
  assert.equal(limiter.check(request('two@example.test')).allowed, true);
  assert.equal(limiter.bucketCount, 4);
  assert.equal(limiter.check(request('three@example.test')).allowed, false);
  assert.equal(limiter.bucketCount, 4);

  now += 1_000;
  assert.equal(limiter.check(request('three@example.test')).allowed, true);
  assert.equal(limiter.bucketCount, 3);
});

test('rotating account identifiers cannot bypass the wider source ceiling', () => {
  const limiter = new ReferenceAppRateLimiter({
    maxBuckets: 100,
    secret: TEST_SECRET,
    policies: { AUTH_SIGN_IN: { limit: 2, windowMs: 60_000 } },
  });
  const request = (index) => ({
    routeOptions: { url: '/api/auth/sign-in' },
    method: 'POST',
    body: { email: `rotated-${index}@example.test` },
    cookies: {},
    headers: {},
    ip: '127.0.0.1',
  });

  for (let index = 0; index < 20; index += 1) {
    assert.equal(limiter.check(request(index)).allowed, true);
  }
  const blocked = limiter.check(request(20));
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.limit, 20);
  assert.equal(blocked.remaining, 0);
});

test('rate-limit configuration cannot be disabled with zero-sized safeguards', () => {
  assert.throws(() => new ReferenceAppRateLimiter({ maxBuckets: 0 }), /positive safe integer/);
  assert.throws(
    () => new ReferenceAppRateLimiter({ policies: { AUTH_SIGN_IN: { limit: 0, windowMs: 1 } } }),
    /AUTH_SIGN_IN\.limit/,
  );
  assert.throws(
    () => new ReferenceAppRateLimiter({ secret: new Uint8Array(16) }),
    /at least 32 bytes/,
  );
});
