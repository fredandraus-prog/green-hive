import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (entry.name === 'dist') {
      await fs.rm(full, { recursive: true, force: true });
      continue;
    }
    if (entry.name !== 'node_modules' && entry.name !== '.git') await walk(full);
  }
}
await walk(root);
console.log('Generated dist directories removed.');
