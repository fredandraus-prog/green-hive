import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const certificateUrl = new URL('../../config/supabase-root-2021-ca.crt', import.meta.url);
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const expectedFingerprint =
  '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA';

test('committed Supabase trust anchor is the official self-signed 2021 root CA', async () => {
  const certificate = new X509Certificate(await readFile(certificateUrl));
  assert.equal(certificate.ca, true);
  assert.equal(certificate.subject, certificate.issuer);
  assert.match(certificate.subject, /O=Supabase Inc/);
  assert.match(certificate.subject, /CN=Supabase Root 2021 CA/);
  assert.equal(certificate.fingerprint256, expectedFingerprint);
  assert.equal(certificate.validFrom, 'Apr 28 10:56:53 2021 GMT');
  assert.equal(certificate.validTo, 'Apr 26 10:56:53 2031 GMT');
});

test('Node loads the committed certificate through NODE_EXTRA_CA_CERTS at process startup', () => {
  const probe = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import { X509Certificate } from 'node:crypto';
       import tls from 'node:tls';
       const fingerprints = tls.getCACertificates('extra')
         .map((value) => new X509Certificate(value).fingerprint256);
       process.exit(fingerprints.includes('${expectedFingerprint}') ? 0 : 1);`,
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        NODE_EXTRA_CA_CERTS: './config/supabase-root-2021-ca.crt',
      },
      encoding: 'utf8',
    },
  );
  assert.equal(probe.status, 0, probe.stderr);
});

test('guarded staging operations use the same committed public trust anchor', async () => {
  const wrapper = await readFile(
    new URL('../../scripts/staging-database-windows.ps1', import.meta.url),
    'utf8',
  );
  assert.match(
    wrapper,
    /Join-Path \$repositoryRoot 'config\\supabase-root-2021-ca\.crt'/,
  );
  assert.match(wrapper, /\$engineRoot = Split-Path -Parent \$repositoryRoot/);
  assert.doesNotMatch(wrapper, /\.secrets\\prod-ca-2021\.crt/);
});
