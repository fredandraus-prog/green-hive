import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const webRoot = new URL('../apps/hive-reference-app/dist/web/', import.meta.url);
const textExtensions = new Set(['.css', '.html', '.js', '.map']);
const forbidden = Object.freeze([
  ['database URL', /(?:DATABASE_URL|postgres(?:ql)?:\/\/)/i],
  ['service-role environment name', /GREEN_HIVE_SUPABASE_SERVICE_ROLE_KEY/i],
  ['Supabase secret key', /(?:sb_secret_|service_role)/i],
  ['server certificate path', /supabase-root-2021-ca\.crt/i],
]);

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) files.push(...await filesUnder(child));
    else files.push(child);
  }
  return files;
}

const files = await filesUnder(webRoot);
const scanned = files.filter((file) => {
  const pathname = new URL(file).pathname;
  const dot = pathname.lastIndexOf('.');
  return dot >= 0 && textExtensions.has(pathname.slice(dot));
});
assert.ok(scanned.some((file) => file.pathname.endsWith('.html')), 'built HTML is required');
assert.ok(scanned.some((file) => file.pathname.endsWith('.js')), 'built JavaScript is required');

for (const file of scanned) {
  const source = await readFile(file, 'utf8');
  for (const [label, pattern] of forbidden) {
    assert.doesNotMatch(source, pattern, `${label} leaked into ${file.pathname.split('/').at(-1)}`);
  }
}

console.log(JSON.stringify({
  status: 'SECURITY_BUNDLE_SMOKE_PASS',
  scannedFiles: scanned.length,
  privateSecrets: 'ABSENT',
}, null, 2));
