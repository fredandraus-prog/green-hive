import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

export function parseMigrationMetadata(sql) {
  const metadata = new Map();
  for (const line of sql.split(/\r?\n/).slice(0, 12)) {
    const match = /^--\s*([a-z_]+):\s*(.+?)\s*$/.exec(line);
    if (match) metadata.set(match[1], match[2]);
  }
  return {
    migrationId: metadata.get('green_hive_migration'),
    checkpoint: metadata.get('checkpoint'),
    description: metadata.get('description'),
    rollbackStrategyCode: metadata.get('rollback_strategy'),
  };
}

export async function loadMigrationCatalog(repositoryRoot) {
  const migrationsDirectory = path.join(repositoryRoot, "database", "migrations");
  const catalogPath = path.join(migrationsDirectory, "migrations.json");
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const sqlFiles = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const migrations = [];
  for (const entry of catalog.migrations ?? []) {
    const sqlPath = path.join(migrationsDirectory, entry.file);
    const sql = await readFile(sqlPath, "utf8");
    migrations.push({
      ...entry,
      sql,
      actualSha256: sha256(sql),
      metadata: parseMigrationMetadata(sql),
      sqlPath,
    });
  }

  return {
    ...catalog,
    catalogPath,
    migrationsDirectory,
    sqlFiles,
    migrations,
  };
}
