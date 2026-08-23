import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { canonicalReleaseContent } from './lib/release-content.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(repositoryRoot, 'MANIFEST-SHA256.txt');
const ignoredDirectories = new Set([
  'node_modules',
  'dist',
  '.git',
  '.cache',
  'coverage',
  '.tmp',
  '.temp',
  '.branches',
]);
const ignoredFiles = new Set(['MANIFEST-SHA256.txt', '.env', '.git']);
const ignoredExtensions = new Set(['.log', '.tmp', '.zip']);

function isIgnoredFile(name) {
  return ignoredFiles.has(name) || (name.startsWith('.env.') && name !== '.env.example');
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
    } else if (!isIgnoredFile(entry.name) && !ignoredExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

const manifest = await readFile(manifestPath, 'utf8');
const entries = new Map();
for (const line of manifest.split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue;
  const match = /^([0-9a-f]{64}) \| ([0-9]+) \| (.+)$/.exec(line);
  if (!match) throw new Error(`Invalid release manifest line: ${line}`);
  const [, expectedHash, expectedSize, relativePath] = match;
  if (path.isAbsolute(relativePath) || relativePath.includes('..') || relativePath.includes('\\')) {
    throw new Error(`Unsafe release path: ${relativePath}`);
  }
  if (entries.has(relativePath)) throw new Error(`Duplicate release path: ${relativePath}`);
  entries.set(relativePath, { expectedHash, expectedSize: Number(expectedSize) });
}

const files = (await walk(repositoryRoot)).sort((left, right) => left.localeCompare(right));
const actualPaths = files.map((file) => path.relative(repositoryRoot, file).replaceAll(path.sep, '/'));
if (JSON.stringify([...entries.keys()].sort()) !== JSON.stringify([...actualPaths].sort())) {
  throw new Error('Release manifest file inventory differs from the current source tree');
}

for (const [index, file] of files.entries()) {
  const relativePath = actualPaths[index];
  const expected = entries.get(relativePath);
  const content = canonicalReleaseContent(await readFile(file));
  const actualHash = createHash('sha256').update(content).digest('hex');
  if (actualHash !== expected.expectedHash || content.length !== expected.expectedSize) {
    throw new Error(`Release manifest drift: ${relativePath}`);
  }
}

console.log(`Release manifest verified: ${entries.size} source files.`);
