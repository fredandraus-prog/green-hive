import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import pg from 'pg';
import { loadMigrationCatalog } from '../../scripts/lib/migration-catalog.mjs';
import { planPendingMigrations } from '../../scripts/lib/migration-state.mjs';
import {
  assertNativeSupabaseContract,
  assertPermittedExternalTarget,
  cleanupGreenHiveFixtures,
  cleanupGreenHiveTestState,
} from '../../scripts/lib/local-supabase-guard.mjs';
import {
  stagingDatabaseConfigurationFromEnvironment,
  SUPABASE_STAGING_TARGET,
} from '../../scripts/lib/staging-guard.mjs';
import { runRlsMatrix } from './helpers/rls-matrix.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const databaseUrl = process.env.GREEN_HIVE_TEST_DATABASE_URL;
const confirmation = process.env.GREEN_HIVE_TEST_CONFIRM;
const target = process.env.GREEN_HIVE_TEST_TARGET;
const localPrepared = process.env.GREEN_HIVE_TEST_PREPARED === 'LOCAL_SUPABASE_BASELINE_READY';
const stagingPrepared =
  process.env.GREEN_HIVE_TEST_PREPARED === 'SUPABASE_STAGING_BASELINE_READY';
const isStaging = target === SUPABASE_STAGING_TARGET;
const prepared = localPrepared || stagingPrepared;

async function applyCatalog(client, catalog) {
  for (const migration of catalog.migrations) {
    await client.query('BEGIN');
    try {
      await client.query(migration.sql);
      await client.query(
        `INSERT INTO hive.schema_migrations
          (version, name, checksum_sha256, rollback_strategy, execution_ms)
         VALUES ($1, $2, $3, $4, 0)`,
        [migration.version, migration.file, migration.sha256, migration.rollbackStrategy],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
}

async function readLedger(client) {
  return (
    await client.query(
      `SELECT version, name, checksum_sha256, rollback_strategy
       FROM hive.schema_migrations
       ORDER BY version`,
    )
  ).rows;
}

async function assertLedgerDriftRejected(client, catalog, mutation, expectedMessage) {
  await client.query('BEGIN');
  try {
    await client.query(mutation);
    const applied = await readLedger(client);
    assert.throws(() => planPendingMigrations(catalog.migrations, applied), expectedMessage);
  } finally {
    await client.query('ROLLBACK');
  }
}

test(
  'GH-0102/GH-0103/GH-0250/GH-0203 external Supabase/PostgreSQL RLS/Audit matrix',
  {
    skip:
      !databaseUrl || !confirmation
        ? 'dedicated external test database not configured'
        : false,
  },
  async (testContext) => {
    if (isStaging) {
      if (!stagingPrepared) throw new Error('Staging RLS suite requires a prepared baseline');
      const staging = stagingDatabaseConfigurationFromEnvironment();
      assert.equal(staging.databaseUrl.toString(), new URL(databaseUrl).toString());
    } else {
      assertPermittedExternalTarget({ databaseUrl, target, confirmation });
    }
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    try {
      await assertNativeSupabaseContract(client);

      const catalog = await loadMigrationCatalog(repositoryRoot);
      if (!prepared) {
        await cleanupGreenHiveTestState(client);
        await applyCatalog(client, catalog);
      } else if (isStaging) {
        await cleanupGreenHiveFixtures(client);
      }

      const seedsDirectory = path.join(repositoryRoot, 'database', 'seeds');
      const seedFiles = (await readdir(seedsDirectory)).filter((name) => name.endsWith('.sql')).sort();
      const seeds = await Promise.all(
        seedFiles.map((seedFile) => readFile(path.join(seedsDirectory, seedFile), 'utf8')),
      );
      const appSeed = seeds[0];
      const billingSeed = seeds[1];
      assert.ok(appSeed && billingSeed, 'canonical app and billing seeds are required');
      const fixture = await readFile(
        path.join(repositoryRoot, 'database', 'tests', 'fixtures', '0001_rls_identities.sql'),
        'utf8',
      );

      const ledger = await readLedger(client);
      assert.equal(ledger.length, catalog.migrations.length);
      assert.equal(planPendingMigrations(catalog.migrations, ledger).length, 0);
      for (const seed of seeds) await client.query(seed);
      for (const seed of seeds) await client.query(seed);
      const referenceApp = await client.query(
        `SELECT id, app_code, app_version, schema_namespace
         FROM hive.apps
         WHERE app_code = 'REFERENCE_APP'`,
      );
      assert.deepEqual(referenceApp.rows, [
        {
          id: '00000000-0000-4000-8000-000000000001',
          app_code: 'REFERENCE_APP',
          app_version: '0.1.0',
          schema_namespace: 'reference_app',
        },
      ]);

      const ownerForeignKey = await client.query(
        `SELECT confrelid::regclass::text AS target
         FROM pg_constraint
         WHERE conrelid = 'hive.projects'::regclass
           AND contype = 'f'
           AND confrelid = 'auth.users'::regclass`,
      );
      assert.equal(ownerForeignKey.rows.length, 1);

      await testContext.test('database-backed immutable ledger drift is rejected', async () => {
        await assertLedgerDriftRejected(
          client,
          catalog,
          "UPDATE hive.schema_migrations SET checksum_sha256 = repeat('0', 64) WHERE version = 1",
          /checksum drift/,
        );
        await assertLedgerDriftRejected(
          client,
          catalog,
          "UPDATE hive.schema_migrations SET name = '0001_renamed.sql' WHERE version = 1",
          /name drift/,
        );
        await assertLedgerDriftRejected(
          client,
          catalog,
          `UPDATE hive.schema_migrations
           SET version = ${catalog.migrations.length + 1}
           WHERE version = ${catalog.migrations.length}`,
          /sequence has a gap/,
        );
        await assertLedgerDriftRejected(
          client,
          catalog,
          "UPDATE hive.schema_migrations SET rollback_strategy = 'Changed after application' WHERE version = 1",
          /rollback metadata drift/,
        );
        await assertLedgerDriftRejected(
          client,
          catalog,
          `INSERT INTO hive.schema_migrations
            (version, name, checksum_sha256, rollback_strategy, execution_ms)
           VALUES (
             ${catalog.migrations.length + 1},
             '${String(catalog.migrations.length + 1).padStart(4, '0')}_unknown.sql',
             repeat('7', 64),
             'Unknown migration',
             0
           )`,
          new RegExp(`unknown migration version ${catalog.migrations.length + 1}`),
        );
      });

      await testContext.test('REFERENCE_APP seed rejects a conflicting UUID', async () => {
        await client.query('BEGIN');
        try {
          await client.query(
            `UPDATE hive.apps
             SET app_code = 'REFERENCE_APP_CANONICAL_HOLD'
             WHERE id = '00000000-0000-4000-8000-000000000001'`,
          );
          await client.query(
            `INSERT INTO hive.apps
              (id, app_code, name, app_version, status, schema_namespace)
             VALUES
              ('00000000-0000-4000-8000-000000000099', 'REFERENCE_APP', 'Conflict', '0.1.0', 'INTERNAL', 'conflict_app')`,
          );
          await assert.rejects(() => client.query(appSeed), /REFERENCE_APP seed conflicts/i);
        } finally {
          await client.query('ROLLBACK');
        }
      });

      await testContext.test(
        'REFERENCE_APP billing seed rejects a conflicting immutable product identity',
        async () => {
        await client.query('BEGIN');
        try {
          await client.query(
            `UPDATE hive.products
             SET product_code = 'REFERENCE_APP_SANDBOX_CANONICAL_HOLD'
             WHERE id = '40000000-0000-4000-8000-000000000001'`,
          );
          await assert.rejects(
            () => client.query(billingSeed),
            /billing product seed conflicts with an immutable identity/i,
          );
        } finally {
          await client.query('ROLLBACK');
        }
        },
      );

      await client.query(fixture);
      await client.query('SET ROLE authenticated');
      await runRlsMatrix((sql, parameters = []) => client.query(sql, parameters), testContext);
    } finally {
      const cleanup = isStaging ? cleanupGreenHiveFixtures : cleanupGreenHiveTestState;
      await cleanup(client).catch(() => undefined);
      await client.end();
    }
  },
);
