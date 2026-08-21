const value = process.env.GREEN_HIVE_HOSTED_APP_ORIGIN?.trim();
if (!value) throw new Error('GREEN_HIVE_HOSTED_APP_ORIGIN is required');

let origin;
try {
  origin = new URL(value);
} catch {
  throw new Error('GREEN_HIVE_HOSTED_APP_ORIGIN must be a valid URL');
}
if (
  origin.protocol !== 'https:' ||
  origin.origin !== origin.href.replace(/\/$/, '') ||
  origin.username ||
  origin.password ||
  ['localhost', '127.0.0.1', '::1'].includes(origin.hostname)
) {
  throw new Error('GREEN_HIVE_HOSTED_APP_ORIGIN must be an exact non-loopback HTTPS origin');
}

async function request(pathname) {
  const response = await fetch(new URL(pathname, origin), {
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.text();
  return { response, body };
}

const health = await request('/api/health');
if (health.response.status !== 200 || JSON.parse(health.body).status !== 'ok') {
  throw new Error('Hosted liveness endpoint did not pass');
}

const readiness = await request('/api/ready');
if (readiness.response.status !== 200 || JSON.parse(readiness.body).status !== 'ready') {
  throw new Error('Hosted readiness endpoint did not pass');
}
if (
  readiness.response.headers.get('strict-transport-security') !==
  'max-age=31536000; includeSubDomains'
) {
  throw new Error('Hosted HTTPS response is missing the required HSTS policy');
}
if (readiness.response.headers.get('cache-control') !== 'private, no-store') {
  throw new Error('Hosted readiness response is not protected from caching');
}

const shell = await request('/');
if (shell.response.status !== 200 || !shell.response.headers.get('content-type')?.includes('text/html')) {
  throw new Error('Hosted Reference App shell did not pass');
}

console.log(JSON.stringify({
  origin: origin.origin,
  liveness: 'PASS',
  readiness: 'PASS',
  httpsHeaders: 'PASS',
  referenceAppShell: 'PASS',
}, null, 2));
