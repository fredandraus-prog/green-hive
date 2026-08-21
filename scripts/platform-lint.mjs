import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagesRoot = path.join(repositoryRoot, "packages");
const errors = [];
const rootManifest = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
const canonicalPackages = [
  'ai',
  'audit',
  'auth',
  'billing',
  'core',
  'cost-guard',
  'entitlements',
  'feature-flags',
  'files',
  'i18n',
  'jobs',
  'notifications',
  'observability',
  'projects',
  'sdk',
  'search',
  'trust',
  'ui',
];

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

const packageEntries = (await readdir(packagesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .sort((left, right) => left.name.localeCompare(right.name));
const actualPackages = packageEntries.map((entry) => entry.name);
if (JSON.stringify(actualPackages) !== JSON.stringify(canonicalPackages)) {
  errors.push(
    `packages/ must contain exactly the 18 canonical packages; found: ${actualPackages.join(', ')}`,
  );
}

for (const entry of packageEntries) {
  if (!entry.isDirectory()) {
    continue;
  }
  const packageDirectory = path.join(packagesRoot, entry.name);
  const manifestPath = path.join(packageDirectory, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!manifest.name?.startsWith("@green-hive/")) {
    errors.push(`${entry.name}/package.json must use the @green-hive namespace`);
  }
  if (manifest.name !== `@green-hive/${entry.name}`) {
    errors.push(`${entry.name}/package.json has unexpected name ${manifest.name}`);
  }
  if (manifest.version !== rootManifest.version) {
    errors.push(`${manifest.name} must use coordinated platform version ${rootManifest.version}`);
  }
  if (
    manifest.main !== './dist/index.js' ||
    manifest.types !== './dist/index.d.ts' ||
    manifest.exports?.['.']?.default !== './dist/index.js' ||
    manifest.exports?.['.']?.types !== './dist/index.d.ts'
  ) {
    errors.push(`${manifest.name} must expose package-local dist entrypoints`);
  }

  for (const dependencyGroup of ["dependencies", "devDependencies", "peerDependencies"]) {
    for (const dependency of Object.keys(manifest[dependencyGroup] ?? {})) {
      if (/beesness|reference-app/i.test(dependency)) {
        errors.push(`${manifest.name} cannot depend on app domain package ${dependency}`);
      }
    }
  }

  for (const file of await walk(packageDirectory)) {
    if (!file.endsWith(".ts")) {
      continue;
    }
    const source = await readFile(file, "utf8");
    if (/from\s+["'][^"']*(beesness|hive-reference-app)[^"']*["']/i.test(source)) {
      errors.push(`${path.relative(repositoryRoot, file)} imports an app domain`);
    }
    if (/from\s+["'][.]{2}[/\\][.]{2}[/\\][.]{2}[/\\]packages[/\\]/i.test(source)) {
      errors.push(`${path.relative(repositoryRoot, file)} bypasses a workspace package export`);
    }
  }
}

if (errors.length > 0) {
  console.error("Platform boundary lint failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log("Platform boundary lint passed.");
}
