import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirectories = new Set([
  '.git',
  '.cache',
  '.tmp',
  '.temp',
  '.branches',
  'coverage',
  'dist',
  'node_modules',
]);
const textExtensions = new Set([
  '.css',
  '.crt',
  '.csv',
  '.example',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.sql',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);
const highConfidenceSecretPatterns = [
  ['private key', /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/],
  ['GitHub token', /\b(?:gh[oprsu]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/],
  ['OpenAI key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ['Supabase secret key', /\bsb_secret_[A-Za-z0-9_-]{20,}\b/],
  ['Render API key', /\brnd_[A-Za-z0-9_-]{20,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
];
const errors = [];

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(fullPath)));
    else files.push(fullPath);
  }
  return files;
}

for (const file of await walk(repositoryRoot)) {
  const relativePath = path.relative(repositoryRoot, file).replaceAll(path.sep, '/');
  const basename = path.basename(file);
  if (
    (basename === '.env' || (basename.startsWith('.env.') && basename !== '.env.example')) ||
    /(?:^|\/)(?:id_rsa|id_ed25519|credentials\.json)$/.test(relativePath) ||
    /\.(?:key|p12|pfx|pem)$/i.test(basename)
  ) {
    errors.push(`${relativePath}: credential-bearing filename must not exist in the repository`);
    continue;
  }
  if (!textExtensions.has(path.extname(file)) && basename !== '.gitignore') continue;
  if (relativePath === 'scripts/security-scan.mjs') continue;
  const content = await readFile(file, 'utf8');
  for (const [label, pattern] of highConfidenceSecretPatterns) {
    if (pattern.test(content)) errors.push(`${relativePath}: possible ${label}`);
  }
  if (
    relativePath.startsWith('apps/hive-reference-app/src/web/') &&
    /DATABASE_URL|SUPABASE_SERVICE_ROLE|SERVICE_ROLE_KEY|FAKE_WEBHOOK_SECRET|process\.env/.test(content)
  ) {
    errors.push(`${relativePath}: server-only configuration crosses into browser source`);
  }
  if (/C:\\Users\\|\/Users\/[^/]+\/|\/home\/[^/]+\//.test(content)) {
    errors.push(`${relativePath}: absolute user path must not enter release source`);
  }
}

if (errors.length > 0) {
  console.error('Security source scan failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Security source scan passed: no credential files, high-confidence secrets or browser leaks.');
}
