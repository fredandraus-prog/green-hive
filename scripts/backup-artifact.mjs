import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REQUIRED_DUMP_FILES = Object.freeze(["roles.sql", "schema.sql", "data.sql"]);
const BACKUP_MANIFEST_VERSION = 1;

function fail(message) {
  throw new Error(`BACKUP_ARTIFACT_INVALID: ${message}`);
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
}

function assertExpectedFiles(files) {
  if (!Array.isArray(files) || files.length !== REQUIRED_DUMP_FILES.length) {
    fail("manifest must describe exactly the three required logical dumps");
  }

  const expected = new Set(REQUIRED_DUMP_FILES);
  const actual = new Set(files.map((file) => file?.name));
  if (actual.size !== expected.size || [...expected].some((name) => !actual.has(name))) {
    fail("manifest dump file names are not the required roles.sql, schema.sql and data.sql set");
  }
}

async function readRequiredDump(directory, name) {
  const filePath = path.resolve(directory, name);
  if (path.dirname(filePath) !== path.resolve(directory)) {
    fail(`invalid dump path for ${name}`);
  }

  let metadata;
  try {
    metadata = await stat(filePath);
  } catch {
    fail(`required dump ${name} is missing`);
  }

  if (!metadata.isFile() || metadata.size === 0) {
    fail(`required dump ${name} must be a non-empty regular file`);
  }

  const content = await readFile(filePath);
  return Object.freeze({
    name,
    bytes: content.byteLength,
    sha256: sha256(content)
  });
}

export async function createBackupManifest({ directory, createdAt, platformVersion }) {
  if (typeof directory !== "string" || directory.length === 0) fail("directory is required");
  if (typeof createdAt !== "string" || Number.isNaN(Date.parse(createdAt))) {
    fail("createdAt must be an ISO timestamp");
  }
  if (typeof platformVersion !== "string" || platformVersion.length === 0) {
    fail("platformVersion is required");
  }

  const files = await Promise.all(REQUIRED_DUMP_FILES.map((name) => readRequiredDump(directory, name)));
  return Object.freeze({
    schemaVersion: BACKUP_MANIFEST_VERSION,
    createdAt,
    platformVersion,
    format: "supabase-logical-dump",
    files
  });
}

export async function verifyBackupManifest({ directory, manifest }) {
  assertPlainObject(manifest, "manifest");
  if (manifest.schemaVersion !== BACKUP_MANIFEST_VERSION) {
    fail("unsupported manifest schema version");
  }
  if (typeof manifest.createdAt !== "string" || Number.isNaN(Date.parse(manifest.createdAt))) {
    fail("manifest createdAt must be an ISO timestamp");
  }
  if (typeof manifest.platformVersion !== "string" || manifest.platformVersion.length === 0) {
    fail("manifest platformVersion is required");
  }
  if (manifest.format !== "supabase-logical-dump") {
    fail("manifest format is unsupported");
  }

  assertExpectedFiles(manifest.files);
  const actualFiles = await Promise.all(
    REQUIRED_DUMP_FILES.map((name) => readRequiredDump(directory, name))
  );
  const expectedByName = new Map(manifest.files.map((file) => [file.name, file]));

  for (const actual of actualFiles) {
    const expected = expectedByName.get(actual.name);
    if (!expected || expected.bytes !== actual.bytes || expected.sha256 !== actual.sha256) {
      fail(`checksum or size mismatch for ${actual.name}`);
    }
  }

  return Object.freeze({ files: actualFiles.length, createdAt: manifest.createdAt });
}

async function readPlatformVersion(packagePath) {
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    fail("root package version is missing");
  }
  return packageJson.version;
}

async function main(argumentsList) {
  const [command, directoryArgument, manifestArgument] = argumentsList;
  if (!command || !directoryArgument || !manifestArgument || argumentsList.length !== 3) {
    fail("usage: write|verify <dump-directory> <manifest-path>");
  }

  const directory = path.resolve(directoryArgument);
  const manifestPath = path.resolve(manifestArgument);

  if (command === "write") {
    const platformVersion = await readPlatformVersion(new URL("../package.json", import.meta.url));
    const manifest = await createBackupManifest({
      directory,
      createdAt: new Date().toISOString(),
      platformVersion
    });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    process.stdout.write(`BACKUP_MANIFEST_CREATED files=${manifest.files.length} version=${platformVersion}\n`);
    return;
  }

  if (command === "verify") {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const result = await verifyBackupManifest({ directory, manifest });
    process.stdout.write(`BACKUP_MANIFEST_VERIFIED files=${result.files}\n`);
    return;
  }

  fail("usage: write|verify <dump-directory> <manifest-path>");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "BACKUP_ARTIFACT_INVALID"}\n`);
    process.exitCode = 1;
  });
}
