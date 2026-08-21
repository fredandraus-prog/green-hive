import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { loadMigrationCatalog } from "./lib/migration-catalog.mjs";
import { planPendingMigrations } from "./lib/migration-state.mjs";
import { validateDatabaseLayout } from "./db-validate.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example and use a dedicated environment.");
}

const validationErrors = await validateDatabaseLayout(repositoryRoot);
if (validationErrors.length > 0) {
  throw new Error(`Refusing migration because db:validate failed:\n${validationErrors.join("\n")}`);
}

const catalog = await loadMigrationCatalog(repositoryRoot);
const client = new pg.Client({ connectionString: databaseUrl });
let locked = false;

try {
  await client.connect();
  await client.query("SELECT pg_advisory_lock(hashtext($1))", ["green-hive-schema-migrations"]);
  locked = true;

  const ledgerResult = await client.query(
    "SELECT to_regclass('hive.schema_migrations')::text AS ledger",
  );
  let ledgerExists = ledgerResult.rows[0]?.ledger === "hive.schema_migrations";
  let appliedRows = [];

  if (ledgerExists) {
    const result = await client.query(
      "SELECT version, name, checksum_sha256, rollback_strategy FROM hive.schema_migrations ORDER BY version",
    );
    appliedRows = result.rows;
    if (appliedRows.length === 0) {
      throw new Error('Migration ledger exists but has no bootstrap entry');
    }
  } else {
    const managedSchemas = await client.query(
      `SELECT nspname
       FROM pg_namespace
       WHERE nspname = ANY($1::text[])
       ORDER BY nspname`,
      [['hive', 'audit', 'reference_app']],
    );
    if (managedSchemas.rows.length > 0) {
      throw new Error(
        `Migration ledger is absent but managed schemas already exist: ${managedSchemas.rows
          .map((row) => row.nspname)
          .join(', ')}`,
      );
    }
  }

  const pending = planPendingMigrations(catalog.migrations, appliedRows);
  for (const applied of appliedRows) console.log(`already applied ${applied.name}`);

  for (const migration of pending) {

    if (!ledgerExists && migration.version !== 1) {
      throw new Error("Migration ledger is missing before a non-bootstrap migration");
    }

    const startedAt = performance.now();
    await client.query("BEGIN");
    try {
      await client.query(migration.sql);
      const executionMs = Math.max(0, Math.round(performance.now() - startedAt));
      await client.query(
        `INSERT INTO hive.schema_migrations
          (version, name, checksum_sha256, rollback_strategy, execution_ms)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          migration.version,
          migration.file,
          migration.sha256,
          migration.rollbackStrategy,
          executionMs,
        ],
      );
      await client.query("COMMIT");
      ledgerExists = true;
      appliedRows.push({
        version: migration.version,
        name: migration.file,
        checksum_sha256: migration.sha256,
        rollback_strategy: migration.rollbackStrategy,
      });
      console.log(`applied ${migration.file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  if (locked) {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", ["green-hive-schema-migrations"]);
  }
  await client.end();
}
