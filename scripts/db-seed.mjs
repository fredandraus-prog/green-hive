import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { validateDatabaseLayout } from "./db-validate.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example and use a dedicated environment.");
}
if (process.env.NODE_ENV === "production" && process.env.ALLOW_PRODUCTION_SEED !== "true") {
  throw new Error("Production seeding requires the explicit ALLOW_PRODUCTION_SEED=true safeguard");
}

const validationErrors = await validateDatabaseLayout(repositoryRoot);
if (validationErrors.length > 0) {
  throw new Error(`Refusing seed because db:validate failed:\n${validationErrors.join("\n")}`);
}

const seedsDirectory = path.join(repositoryRoot, "database", "seeds");
const seedFiles = (await readdir(seedsDirectory)).filter((name) => name.endsWith(".sql")).sort();
const client = new pg.Client({ connectionString: databaseUrl });

try {
  await client.connect();
  const ledger = await client.query("SELECT to_regclass('hive.schema_migrations')::text AS ledger");
  if (ledger.rows[0]?.ledger !== "hive.schema_migrations") {
    throw new Error("Run db:migrate before db:seed");
  }

  await client.query("SELECT pg_advisory_lock(hashtext($1))", ["green-hive-structural-seeds"]);
  for (const file of seedFiles) {
    const sql = await readFile(path.join(seedsDirectory, file), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("COMMIT");
      console.log(`seeded ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  await client.query("SELECT pg_advisory_unlock(hashtext($1))", ["green-hive-structural-seeds"]);
} finally {
  await client.end();
}

