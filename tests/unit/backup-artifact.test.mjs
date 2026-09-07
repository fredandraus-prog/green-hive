import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createCipheriv, createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createBackupManifest, verifyBackupManifest, verifyEncryptedBackup } from "../../scripts/backup-artifact.mjs";
import { assertArchiveInventory, decryptOpenSslPbkdf2, extractRoleNames, targetBootstrapSql } from "../../scripts/backup-recovery-local.mjs";

async function withBackupDirectory(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "green-hive-backup-artifact-"));
  try {
    await Promise.all([
      writeFile(path.join(directory, "roles.sql"), "-- roles\n"),
      writeFile(path.join(directory, "schema.sql"), "-- schema\n"),
      writeFile(path.join(directory, "data.sql"), "COPY hive.apps FROM stdin;\n")
    ]);
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("backup manifest records only the required logical dump hashes", async () => {
  await withBackupDirectory(async (directory) => {
    const manifest = await createBackupManifest({
      directory,
      createdAt: "2026-09-07T12:00:00.000Z",
      platformVersion: "0.32.0"
    });

    assert.deepEqual(manifest.files.map((file) => file.name), ["roles.sql", "schema.sql", "data.sql"]);
    assert.ok(manifest.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
    assert.deepEqual(await verifyBackupManifest({ directory, manifest }), {
      files: 3,
      createdAt: "2026-09-07T12:00:00.000Z"
    });
  });
});

test("backup manifest rejects a modified dump before recovery", async () => {
  await withBackupDirectory(async (directory) => {
    const manifest = await createBackupManifest({
      directory,
      createdAt: "2026-09-07T12:00:00.000Z",
      platformVersion: "0.32.0"
    });
    await writeFile(path.join(directory, "data.sql"), "tampered\n");

    await assert.rejects(
      verifyBackupManifest({ directory, manifest }),
      /BACKUP_ARTIFACT_INVALID: checksum or size mismatch for data\.sql/
    );
  });
});

test("backup manifest never treats an empty logical dump as recoverable", async () => {
  await withBackupDirectory(async (directory) => {
    await writeFile(path.join(directory, "roles.sql"), "");
    await assert.rejects(
      createBackupManifest({
        directory,
        createdAt: "2026-09-07T12:00:00.000Z",
        platformVersion: "0.32.0"
      }),
      /BACKUP_ARTIFACT_INVALID: required dump roles\.sql must be a non-empty regular file/
    );
  });
});

test("encrypted backup verification accepts a portable checksum sidecar without trusting its path", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "green-hive-encrypted-backup-"));
  try {
    const archivePath = path.join(directory, "logical-backup.tar.gz.enc");
    const checksumPath = path.join(directory, "logical-backup.tar.gz.enc.sha256");
    const encrypted = Buffer.from("encrypted backup bytes");
    const digest = createHash("sha256").update(encrypted).digest("hex");
    await writeFile(archivePath, encrypted);
    await writeFile(checksumPath, `${digest}  /runner-temporary/logical-backup.tar.gz.enc\n`);

    assert.deepEqual(await verifyEncryptedBackup({ archivePath, checksumPath }), {
      bytes: encrypted.byteLength,
      sha256: digest
    });

    await writeFile(archivePath, "modified");
    await assert.rejects(
      verifyEncryptedBackup({ archivePath, checksumPath }),
      /BACKUP_ARTIFACT_INVALID: encrypted archive checksum mismatch/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("recovery accepts only the exact logical backup inventory", () => {
  assert.doesNotThrow(() =>
    assertArchiveInventory("schema.sql\nroles.sql\nbackup-manifest.json\ndata.sql\n")
  );
  assert.throws(
    () => assertArchiveInventory("schema.sql\nroles.sql\nbackup-manifest.json\ndata.sql\nunexpected.txt\n"),
    /LOCAL_RECOVERY_INVALID: decrypted archive has an unexpected file inventory/
  );
});

test("local recovery decrypts the exact PBKDF2 OpenSSL archive format without OpenSSL installed", () => {
  const passphrase = "green-hive-local-recovery-passphrase-123456789";
  const salt = randomBytes(8);
  const plaintext = Buffer.from("compressed logical archive bytes");
  const material = pbkdf2Sync(Buffer.from(passphrase, "utf8"), salt, 600000, 48, "sha256");
  const cipher = createCipheriv("aes-256-cbc", material.subarray(0, 32), material.subarray(32, 48));
  const encrypted = Buffer.concat([
    Buffer.from("Salted__", "ascii"),
    salt,
    cipher.update(plaintext),
    cipher.final()
  ]);

  assert.deepEqual(decryptOpenSslPbkdf2(encrypted, passphrase), plaintext);
  assert.throws(
    () => decryptOpenSslPbkdf2(encrypted, "a-different-valid-length-passphrase-123456"),
    /LOCAL_RECOVERY_INVALID: backup passphrase is incorrect or the encrypted archive is corrupted/
  );
});

test("local recovery prepares only roles declared by a verified Supabase role dump", () => {
  assert.deepEqual(
    extractRoleNames("ALTER ROLE anon NOLOGIN;\nALTER ROLE \"service_role\" NOLOGIN;\nCREATE ROLE postgres;\n"),
    ["anon", "postgres", "service_role"]
  );
  assert.throws(
    () => extractRoleNames("GRANT SELECT ON TABLE hive.apps TO authenticated;\n"),
    /LOCAL_RECOVERY_INVALID: roles dump does not declare a recoverable role set/
  );
});

test("role discovery accepts the additional Supabase realtime administrative role", () => {
  assert.deepEqual(
    extractRoleNames("ALTER ROLE supabase_realtime_admin SET statement_timeout TO '0';\n"),
    ["supabase_realtime_admin"]
  );
});

test("local recovery compatibility uses only identifier-shaped Supabase schema names", () => {
  const accepted = /^([A-Za-z_][A-Za-z0-9_]*)$/;
  assert.ok(accepted.test("extensions"));
  assert.ok(accepted.test("supabase_functions"));
  assert.equal(accepted.test("extensions; DROP SCHEMA public"), false);
});

test("recovery target carries the official additive Storage versioning compatibility", () => {
  const bootstrap = targetBootstrapSql();
  assert.match(bootstrap, /ADD COLUMN IF NOT EXISTS versioning_status text NOT NULL DEFAULT 'DISABLED'/);
  assert.match(bootstrap, /versioning_status IN \('DISABLED', 'ENABLED', 'SUSPENDED'\)/);
  assert.match(bootstrap, /ADD COLUMN IF NOT EXISTS archived_at timestamptz/);
});
