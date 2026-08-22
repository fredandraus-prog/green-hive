import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { canonicalReleaseContent } from './lib/release-content.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(repositoryRoot, "MANIFEST-SHA256.txt");
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
const ignoredFiles = new Set(['MANIFEST-SHA256.txt', '.env']);
const ignoredExtensions = new Set(['.log', '.tmp', '.zip']);

function isIgnoredFile(name) {
  return ignoredFiles.has(name) || (name.startsWith('.env.') && name !== '.env.example');
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
    } else if (!isIgnoredFile(entry.name) && !ignoredExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

const files = (await walk(repositoryRoot)).sort((left, right) => left.localeCompare(right));
const lines = [
  "# Green Hive release source manifest",
  "# SHA-256 | canonical bytes | relative path",
];

for (const file of files) {
  const content = canonicalReleaseContent(await readFile(file));
  const hash = createHash("sha256").update(content).digest("hex");
  const relativePath = path.relative(repositoryRoot, file).replaceAll(path.sep, "/");
  lines.push(`${hash} | ${content.length} | ${relativePath}`);
}

await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote ${files.length} entries to MANIFEST-SHA256.txt`);
