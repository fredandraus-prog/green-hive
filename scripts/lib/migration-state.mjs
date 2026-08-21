export function validateAppliedMigrations(catalogMigrations, appliedRows) {
  const errors = [];
  const ordered = [...appliedRows].sort((left, right) => Number(left.version) - Number(right.version));

  for (const [index, row] of ordered.entries()) {
    const version = Number(row.version);
    const expectedVersion = index + 1;
    if (version !== expectedVersion) {
      errors.push(`Applied migration sequence has a gap: expected ${expectedVersion}, found ${version}`);
      continue;
    }

    const expected = catalogMigrations[index];
    if (!expected) {
      errors.push(`Database contains unknown migration version ${version}`);
      continue;
    }
    if (row.name !== expected.file) {
      errors.push(`Migration ${version} name drift: expected ${expected.file}, found ${row.name}`);
    }
    if (row.checksum_sha256 !== expected.sha256) {
      errors.push(`Migration ${version} checksum drift: ${expected.file}`);
    }
    if (row.rollback_strategy !== expected.rollbackStrategy) {
      errors.push(`Migration ${version} rollback metadata drift: ${expected.file}`);
    }
  }

  return errors;
}

export function planPendingMigrations(catalogMigrations, appliedRows) {
  const errors = validateAppliedMigrations(catalogMigrations, appliedRows);
  if (errors.length > 0) {
    throw new Error(`Immutable migration state is invalid:\n${errors.join('\n')}`);
  }
  return catalogMigrations.slice(appliedRows.length);
}
