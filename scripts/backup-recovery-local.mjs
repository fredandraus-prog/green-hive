import { spawnSync } from "node:child_process";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { verifyBackupManifest, verifyEncryptedBackup } from "./backup-artifact.mjs";

const EXPECTED_ARCHIVE_FILES = Object.freeze(["backup-manifest.json", "data.sql", "roles.sql", "schema.sql"]);
const OPENSSL_SALTED_HEADER = Buffer.from("Salted__", "ascii");
const OPENSSL_PBKDF2_ITERATIONS = 600000;

function fail(message) {
  throw new Error(`LOCAL_RECOVERY_INVALID: ${message}`);
}

async function listFiles(directory) {
  const names = await readdir(directory);
  return names.sort((left, right) => left.localeCompare(right));
}

async function findArtifact(directory) {
  const names = await listFiles(directory);
  const archive = names.filter((name) => name === "logical-backup.tar.gz.enc");
  const checksum = names.filter((name) => name === "logical-backup.tar.gz.enc.sha256");
  if (archive.length !== 1 || checksum.length !== 1) {
    fail("artifact directory must contain exactly logical-backup.tar.gz.enc and its checksum sidecar");
  }
  return Object.freeze({
    archivePath: path.join(directory, archive[0]),
    checksumPath: path.join(directory, checksum[0])
  });
}

function run(command, argumentsList, options = {}) {
  const result = spawnSync(command, argumentsList, {
    encoding: "utf8",
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error || result.status !== 0) {
    fail(`${command} failed while preparing the disposable recovery target`);
  }
  return result.stdout;
}

/**
 * Decrypts the exact OpenSSL `enc -aes-256-cbc -salt -pbkdf2 -iter 600000`
 * payload emitted by the backup workflow. Keeping this in Node makes local
 * recovery work on Windows without adding a second crypto installation.
 */
export function decryptOpenSslPbkdf2(encrypted, passphrase) {
  if (!Buffer.isBuffer(encrypted) || encrypted.byteLength <= 16) {
    fail("encrypted archive is too short for the OpenSSL salted format");
  }
  if (!encrypted.subarray(0, 8).equals(OPENSSL_SALTED_HEADER)) {
    fail("encrypted archive is not an OpenSSL salted payload");
  }
  if (typeof passphrase !== "string" || passphrase.length < 32) {
    fail("a backup passphrase of at least 32 characters is required locally");
  }

  const material = pbkdf2Sync(
    Buffer.from(passphrase, "utf8"),
    encrypted.subarray(8, 16),
    OPENSSL_PBKDF2_ITERATIONS,
    48,
    "sha256"
  );
  try {
    const decipher = createDecipheriv("aes-256-cbc", material.subarray(0, 32), material.subarray(32, 48));
    return Buffer.concat([decipher.update(encrypted.subarray(16)), decipher.final()]);
  } catch {
    fail("backup passphrase is incorrect or the encrypted archive is corrupted");
  }
}

export function assertArchiveInventory(rawInventory) {
  const files = rawInventory.trim().split(/\r?\n/).filter(Boolean).sort((left, right) => left.localeCompare(right));
  if (files.length !== EXPECTED_ARCHIVE_FILES.length || files.some((file, index) => file !== EXPECTED_ARCHIVE_FILES[index])) {
    fail("decrypted archive has an unexpected file inventory");
  }
}

/**
 * A Supabase role-only dump commonly begins with ALTER ROLE statements, while
 * a stock PostgreSQL container does not contain Supabase's runtime roles.
 * Extract only ordinary identifier-shaped role names from the verified dump;
 * nothing from the dump is otherwise interpolated into bootstrap SQL.
 */
export function extractRoleNames(rawRolesSql) {
  if (typeof rawRolesSql !== "string") fail("roles dump must be UTF-8 text");
  const roles = new Set();
  const roleStatement = /^\s*(?:ALTER|CREATE)\s+ROLE\s+(?:"([A-Za-z_][A-Za-z0-9_]*)"|([A-Za-z_][A-Za-z0-9_]*))(?=\s|;|$)/gim;
  for (const match of rawRolesSql.matchAll(roleStatement)) {
    roles.add(match[1] ?? match[2]);
  }
  if (roles.size === 0) fail("roles dump does not declare a recoverable role set");
  return Object.freeze([...roles].sort((left, right) => left.localeCompare(right)));
}

function roleBootstrapSql(roleNames) {
  const sqlNames = roleNames.map((role) => `'${role}'`).join(", ");
  return `
DO $recovery$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[${sqlNames}] LOOP
    IF role_name <> current_user AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS', role_name);
    END IF;
  END LOOP;
END $recovery$;
`;
}

export function targetBootstrapSql() {
  return `
CREATE SCHEMA IF NOT EXISTS extensions;
-- Supabase Storage tenant migration 0062-object-versioning-core.sql. This
-- applies only to the disposable recovery database when local CLI images lag
-- behind the hosted Storage schema carried by the verified backup.
ALTER TABLE storage.buckets
  ADD COLUMN IF NOT EXISTS versioning_status text NOT NULL DEFAULT 'DISABLED';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'storage.buckets'::regclass AND conname = 'buckets_versioning_status_check') THEN
    ALTER TABLE storage.buckets ADD CONSTRAINT buckets_versioning_status_check CHECK (versioning_status IN ('DISABLED', 'ENABLED', 'SUSPENDED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'storage.buckets'::regclass AND conname = 'buckets_versioning_standard_only_check') THEN
    ALTER TABLE storage.buckets ADD CONSTRAINT buckets_versioning_standard_only_check CHECK (type = 'STANDARD' OR versioning_status = 'DISABLED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'storage.buckets'::regclass AND conname = 'buckets_versioning_dark_check') THEN
    ALTER TABLE storage.buckets ADD CONSTRAINT buckets_versioning_dark_check CHECK (versioning_status = 'DISABLED');
  END IF;
END;
$$;
ALTER TABLE storage.objects
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_delete_marker boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_versioned boolean NOT NULL DEFAULT false;
`;
}

function verificationSql(expectedMigrations) {
  return `
DO $$
DECLARE orphan_count integer;
BEGIN
  IF to_regnamespace('hive') IS NULL OR to_regnamespace('audit') IS NULL OR to_regnamespace('reference_app') IS NULL THEN
    RAISE EXCEPTION 'RECOVERY_SCHEMA_SET_INCOMPLETE';
  END IF;
  IF (SELECT count(*) FROM hive.schema_migrations) <> ${expectedMigrations} THEN
    RAISE EXCEPTION 'RECOVERY_LEDGER_COUNT_MISMATCH';
  END IF;
  IF (SELECT count(*) FROM hive.apps WHERE app_code = 'REFERENCE_APP') <> 1 THEN
    RAISE EXCEPTION 'RECOVERY_REFERENCE_APP_MISSING';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'hive.projects'::regclass) THEN
    RAISE EXCEPTION 'RECOVERY_RLS_MISSING';
  END IF;
  SELECT count(*) INTO orphan_count FROM hive.user_profiles profile LEFT JOIN auth.users user_row ON user_row.id = profile.user_id WHERE user_row.id IS NULL;
  IF orphan_count <> 0 THEN RAISE EXCEPTION 'RECOVERY_AUTH_DEPENDENCY_UNRESOLVED'; END IF;
  SELECT count(*) INTO orphan_count FROM hive.projects project LEFT JOIN auth.users user_row ON user_row.id = project.owner_user_id WHERE user_row.id IS NULL;
  IF orphan_count <> 0 THEN RAISE EXCEPTION 'RECOVERY_AUTH_DEPENDENCY_UNRESOLVED'; END IF;
END $$;
`;
}

export async function prepareLocalRecovery({ artifactDirectory, workspace, passphrase }) {
  if (typeof passphrase !== "string" || passphrase.length < 32) {
    fail("a backup passphrase of at least 32 characters is required locally");
  }
  const artifact = await findArtifact(path.resolve(artifactDirectory));
  await verifyEncryptedBackup(artifact);

  await mkdir(workspace, { recursive: false });
  const archivePath = path.join(workspace, "logical-backup.tar.gz");
  const plainDirectory = path.join(workspace, "plain");
  try {
    const encrypted = await readFile(artifact.archivePath);
    await writeFile(archivePath, decryptOpenSslPbkdf2(encrypted, passphrase));
    assertArchiveInventory(run("tar", ["--list", "--gzip", "--file", archivePath]));
    await mkdir(plainDirectory);
    run("tar", ["--extract", "--gzip", "--file", archivePath, "--directory", plainDirectory]);
    const manifest = JSON.parse(await readFile(path.join(plainDirectory, "backup-manifest.json"), "utf8"));
    await verifyBackupManifest({ directory: plainDirectory, manifest });
    const roleNames = extractRoleNames(await readFile(path.join(plainDirectory, "roles.sql"), "utf8"));

    const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../database/migrations");
    const migrationCount = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).length;
    await writeFile(path.join(workspace, "roles-bootstrap.sql"), roleBootstrapSql(roleNames), "utf8");
    await writeFile(path.join(workspace, "target-bootstrap.sql"), targetBootstrapSql(), "utf8");
    await writeFile(path.join(workspace, "verify-recovery.sql"), verificationSql(migrationCount), "utf8");
    await rm(archivePath, { force: true });
    return Object.freeze({ workspace, plainDirectory, migrationCount, roles: roleNames.length });
  } catch (error) {
    await rm(workspace, { recursive: true, force: true });
    throw error;
  }
}

async function main(argumentsList) {
  const [command, artifactDirectory, workspace] = argumentsList;
  if (command !== "prepare" || !artifactDirectory || !workspace || argumentsList.length !== 3) {
    fail("usage: prepare <artifact-directory> <empty-temporary-workspace>");
  }
  const result = await prepareLocalRecovery({
    artifactDirectory,
    workspace,
    passphrase: process.env.GREEN_HIVE_BACKUP_PASSPHRASE ?? ""
  });
  process.stdout.write(`LOCAL_RECOVERY_PREPARED migrations=${result.migrationCount} roles=${result.roles}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "LOCAL_RECOVERY_INVALID"}\n`);
    process.exitCode = 1;
  });
}
