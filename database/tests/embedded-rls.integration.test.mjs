import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { loadMigrationCatalog } from '../../scripts/lib/migration-catalog.mjs';
import { planPendingMigrations } from '../../scripts/lib/migration-state.mjs';
import { runRlsMatrix } from './helpers/rls-matrix.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function createDatabase() {
  return new PGlite({ extensions: { pgcrypto } });
}

const authShim = `
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION auth.jwt()
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog
  AS $$
  DECLARE
    raw_claims text;
  BEGIN
    raw_claims := current_setting('request.jwt.claims', true);
    IF raw_claims IS NULL OR btrim(raw_claims) = '' THEN
      RETURN '{}'::jsonb;
    END IF;
    BEGIN
      RETURN raw_claims::jsonb;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN '{}'::jsonb;
    END;
  END;
  $$;
  CREATE FUNCTION auth.uid()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SET search_path = ''
  AS $$
    SELECT nullif(auth.jwt() ->> 'sub', '')::uuid;
  $$;
  CREATE ROLE authenticated
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  GRANT USAGE ON SCHEMA auth TO authenticated;
  GRANT EXECUTE ON FUNCTION auth.jwt() TO authenticated;
  GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
`;

async function applyMigrations(database, catalog) {
  for (const migration of catalog.migrations) {
    await database.exec(`BEGIN;\n${migration.sql}\nCOMMIT;`);
    await database.query(
      `INSERT INTO hive.schema_migrations
        (version, name, checksum_sha256, rollback_strategy, execution_ms)
       VALUES ($1, $2, $3, $4, 0)`,
      [migration.version, migration.file, migration.sha256, migration.rollbackStrategy],
    );
  }
}

test('fresh migrations, immutable ledger, seed and GH-0203 RLS/Audit matrix', async (testContext) => {
  const database = createDatabase();
  await database.waitReady;

  try {
    await database.exec(authShim);
    const catalog = await loadMigrationCatalog(repositoryRoot);
    await applyMigrations(database, catalog);

    const ledger = await database.query(
      `SELECT version, name, checksum_sha256, rollback_strategy
       FROM hive.schema_migrations
       ORDER BY version`,
    );
    assert.equal(ledger.rows.length, catalog.migrations.length);
    assert.equal(planPendingMigrations(catalog.migrations, ledger.rows).length, 0);

    const seed = await readFile(
      path.join(repositoryRoot, 'database', 'seeds', '0001_reference_app.sql'),
      'utf8',
    );
    const fixture = await readFile(
      path.join(repositoryRoot, 'database', 'tests', 'fixtures', '0001_rls_identities.sql'),
      'utf8',
    );
    await database.exec(`BEGIN;\n${seed}\nCOMMIT;`);
    await database.exec(`BEGIN;\n${seed}\nCOMMIT;`);
    const referenceApps = await database.query(
      "SELECT count(*)::integer AS count FROM hive.apps WHERE app_code = 'REFERENCE_APP'",
    );
    assert.equal(referenceApps.rows[0].count, 1);
    await database.exec(`BEGIN;\n${fixture}\nCOMMIT;`);
    await database.exec('SET ROLE authenticated;');

    await runRlsMatrix((sql, parameters = []) => database.query(sql, parameters), testContext);
  } finally {
    await database.close();
  }
});

test('REFERENCE_APP seed rejects a conflicting immutable identity', async () => {
  const database = createDatabase();
  await database.waitReady;
  try {
    await database.exec(authShim);
    const catalog = await loadMigrationCatalog(repositoryRoot);
    await applyMigrations(database, catalog);
    await database.exec(`
      INSERT INTO hive.apps
        (id, app_code, name, app_version, status, schema_namespace)
      VALUES
        ('00000000-0000-4000-8000-000000000099', 'REFERENCE_APP', 'Conflict', '0.1.0', 'INTERNAL', 'conflict_app');
    `);
    const seed = await readFile(
      path.join(repositoryRoot, 'database', 'seeds', '0001_reference_app.sql'),
      'utf8',
    );
    await assert.rejects(
      () => database.exec(`BEGIN;\n${seed}\nCOMMIT;`),
      /REFERENCE_APP seed conflicts/i,
    );
  } finally {
    await database.close();
  }
});
