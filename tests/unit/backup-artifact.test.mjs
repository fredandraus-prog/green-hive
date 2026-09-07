import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createBackupManifest, verifyBackupManifest } from "../../scripts/backup-artifact.mjs";

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
