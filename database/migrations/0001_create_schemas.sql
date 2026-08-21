-- green_hive_migration: 0001
-- checkpoint: GH-0102
-- description: Create managed schemas, pgcrypto and the immutable migration ledger.
-- rollback_strategy: SNAPSHOT_OR_FORWARD_FIX

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA hive;
CREATE SCHEMA audit;
CREATE SCHEMA reference_app;

CREATE TABLE hive.schema_migrations (
  version integer PRIMARY KEY,
  name text NOT NULL UNIQUE,
  checksum_sha256 text NOT NULL,
  rollback_strategy text NOT NULL,
  execution_ms integer NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by text NOT NULL DEFAULT current_user,
  CONSTRAINT schema_migrations_version_positive CHECK (version > 0),
  CONSTRAINT schema_migrations_checksum_format CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT schema_migrations_execution_ms_nonnegative CHECK (execution_ms >= 0)
);

COMMENT ON TABLE hive.schema_migrations IS
  'Immutable migration ledger. A checksum mismatch is deployment drift, never an implicit repair.';
