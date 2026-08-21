import assert from 'node:assert/strict';
import test from 'node:test';
import {
  planPendingMigrations,
  validateAppliedMigrations,
} from '../../scripts/lib/migration-state.mjs';

const migrations = [
  {
    version: 1,
    file: '0001_create_schemas.sql',
    sha256: 'a'.repeat(64),
    rollbackStrategy: 'Restore the verified snapshot before retrying.',
  },
  {
    version: 2,
    file: '0002_create_apps.sql',
    sha256: 'b'.repeat(64),
    rollbackStrategy: 'Deploy a forward correction before retrying.',
  },
];

const applied = migrations.map((migration) => ({
  version: migration.version,
  name: migration.file,
  checksum_sha256: migration.sha256,
  rollback_strategy: migration.rollbackStrategy,
}));

test('a valid applied prefix plans only pending immutable migrations', () => {
  assert.deepEqual(planPendingMigrations(migrations, []), migrations);
  assert.deepEqual(planPendingMigrations(migrations, applied.slice(0, 1)), migrations.slice(1));
  assert.deepEqual(planPendingMigrations(migrations, applied), []);
});

test('checksum and filename drift are rejected', () => {
  const drifted = [{ ...applied[0], name: '0001_changed.sql', checksum_sha256: 'c'.repeat(64) }];
  const errors = validateAppliedMigrations(migrations, drifted);
  assert.ok(errors.some((error) => error.includes('name drift')));
  assert.ok(errors.some((error) => error.includes('checksum drift')));
  assert.throws(() => planPendingMigrations(migrations, drifted), /Immutable migration state/);
});

test('unknown versions and gaps are rejected', () => {
  const gapErrors = validateAppliedMigrations(migrations, [applied[0], { ...applied[1], version: 3 }]);
  assert.ok(gapErrors.some((error) => error.includes('gap')));

  const unknownErrors = validateAppliedMigrations(migrations, [
    ...applied,
    {
      version: 3,
      name: '0003_unknown.sql',
      checksum_sha256: 'c'.repeat(64),
      rollback_strategy: 'Unknown database migration',
    },
  ]);
  assert.ok(unknownErrors.some((error) => error.includes('unknown migration version 3')));
});

test('rollback metadata drift is rejected', () => {
  const drifted = [{ ...applied[0], rollback_strategy: 'Changed after application' }];
  assert.ok(
    validateAppliedMigrations(migrations, drifted).some((error) =>
      error.includes('rollback metadata drift'),
    ),
  );
});
