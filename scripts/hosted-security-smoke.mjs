import assert from 'node:assert/strict';

const EXPECTED_ORIGIN = 'https://green-hive-staging.onrender.com';
const EXPECTED_CONFIRMATION = 'EXERCISE_STAGING_RATE_LIMIT';
const originValue = process.env.GREEN_HIVE_HOSTED_APP_ORIGIN?.trim();
const confirmation = process.env.GREEN_HIVE_HOSTED_SECURITY_CONFIRM?.trim();

if (originValue !== EXPECTED_ORIGIN) {
  throw new Error(`GREEN_HIVE_HOSTED_APP_ORIGIN must be exactly ${EXPECTED_ORIGIN}`);
}
if (confirmation !== EXPECTED_CONFIRMATION) {
  throw new Error(
    `GREEN_HIVE_HOSTED_SECURITY_CONFIRM must be exactly ${EXPECTED_CONFIRMATION}`,
  );
}

const origin = new URL(originValue);
const email = `hosted-security-${Date.now()}-${process.pid}@example.test`;
const password = `InvalidHostedSecurity-${Date.now()}-Aa1!`;

async function request(pathname, options = {}) {
  return fetch(new URL(pathname, origin), {
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
    ...options,
  });
}

async function signIn(candidateEmail) {
  return request('/api/auth/sign-in', {
    method: 'POST',
    headers: {
      origin: origin.origin,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email: candidateEmail, password }),
  });
}

for (let attempt = 1; attempt <= 10; attempt += 1) {
  const response = await signIn(email);
  assert.equal(response.status, 401, `attempt ${attempt} must reach the guarded Auth boundary`);
  const body = await response.json();
  assert.equal(body?.error?.code, 'AUTH_INVALID_CREDENTIALS');
  assert.equal(response.headers.get('ratelimit-limit'), '10');
  assert.equal(response.headers.get('ratelimit-remaining'), String(10 - attempt));
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
}

const blocked = await signIn(email);
assert.equal(blocked.status, 429);
const blockedBody = await blocked.json();
assert.deepEqual(blockedBody, {
  error: {
    code: 'RATE_LIMITED',
    category: 'RATE_LIMITED',
    status: 429,
    retryable: true,
    message: 'Request could not be completed.',
  },
});
assert.equal(blocked.headers.get('ratelimit-limit'), '10');
assert.equal(blocked.headers.get('ratelimit-remaining'), '0');
assert.match(blocked.headers.get('ratelimit-policy') ?? '', /^10;w=900$/);
assert.match(blocked.headers.get('retry-after') ?? '', /^\d+$/);

const independent = await signIn(`independent-${email}`);
assert.equal(independent.status, 401);
assert.equal(independent.headers.get('ratelimit-remaining'), '9');

for (const pathname of ['/api/health', '/api/ready']) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await request(pathname);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('ratelimit-limit'), null);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(response.headers.get('x-dns-prefetch-control'), 'off');
    assert.equal(response.headers.get('x-permitted-cross-domain-policies'), 'none');
  }
}

console.log(JSON.stringify({
  status: 'HOSTED_SECURITY_SMOKE_PASS',
  origin: origin.origin,
  checks: {
    repeatedAuthRequests: 'LIMITED',
    accountScope: 'PASS',
    rateLimitHeaders: 'PASS',
    healthProbeExemption: 'PASS',
    securityHeaders: 'PASS',
  },
}, null, 2));
