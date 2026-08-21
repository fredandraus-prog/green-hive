import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignored = new Set([
  'node_modules',
  'dist',
  '.git',
  '.cache',
  '.tmp',
  '.temp',
  '.branches',
]);
const textExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.json', '.md', '.csv', '.sql', '.css', '.html']);
const errors = [];

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}

const files = await walk(root);
for (const file of files) {
  if (!textExtensions.has(path.extname(file))) continue;
  const rel = path.relative(root, file);
  const content = await fs.readFile(file, 'utf8');
  if (rel === `scripts${path.sep}lint.mjs`) continue;

  if (/BeeGreen Hive/i.test(content)) {
    errors.push(`${rel}: uses deprecated platform name "BeeGreen Hive"`);
  }

  if (rel.startsWith(`packages${path.sep}`) && /@(?:beegreen|green-hive)\/(?:beesness|app-)/i.test(content)) {
    errors.push(`${rel}: Green Hive package imports an application-domain package`);
  }

  if (/(?:sk-[A-Za-z0-9]{20,}|BEGIN PRIVATE KEY|service_role\s*=\s*['"][^'"]+)/.test(content)) {
    errors.push(`${rel}: possible committed secret`);
  }
}

if (errors.length) {
  console.error('Platform lint failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Platform lint passed (${files.length} files scanned).`);
