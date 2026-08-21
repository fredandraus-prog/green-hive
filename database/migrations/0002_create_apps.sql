-- green_hive_migration: 0002
-- checkpoint: GH-0102
-- description: Create the canonical Green Hive application registry.
-- rollback_strategy: FORWARD_FIX_OR_EMPTY_ENVIRONMENT_DROP

CREATE TABLE hive.apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_code text NOT NULL UNIQUE,
  name text NOT NULL,
  app_version text NOT NULL,
  status text NOT NULL DEFAULT 'INTERNAL',
  schema_namespace text NOT NULL UNIQUE,
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT apps_app_code_format CHECK (app_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  CONSTRAINT apps_name_present CHECK (char_length(btrim(name)) BETWEEN 2 AND 160),
  CONSTRAINT apps_version_semver CHECK (
    app_version ~ '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
  ),
  CONSTRAINT apps_status_known CHECK (status IN ('INTERNAL', 'BETA', 'ACTIVE', 'DISABLED')),
  CONSTRAINT apps_schema_namespace_format CHECK (
    schema_namespace ~ '^[a-z][a-z0-9_]{1,62}$'
  ),
  CONSTRAINT apps_manifest_object CHECK (jsonb_typeof(manifest) = 'object'),
  CONSTRAINT apps_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

COMMENT ON TABLE hive.apps IS
  'Registry of Green Hive consumer applications. App-domain tables remain in consumer schemas.';
