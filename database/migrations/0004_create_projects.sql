-- green_hive_migration: 0004
-- checkpoint: GH-0103
-- description: Create app-neutral projects with owner, app and lifecycle constraints.
-- rollback_strategy: FORWARD_FIX_OR_VERIFIED_PROJECT_EXPORT_RESTORE

CREATE TABLE hive.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_app_fk
    FOREIGN KEY (app_id) REFERENCES hive.apps(id) ON DELETE RESTRICT,
  CONSTRAINT projects_owner_fk
    FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT projects_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  CONSTRAINT projects_status_known CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED', 'DELETED')),
  CONSTRAINT projects_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT projects_lifecycle_consistent CHECK (
    (status IN ('DRAFT', 'ACTIVE') AND archived_at IS NULL AND deleted_at IS NULL)
    OR (status = 'ARCHIVED' AND archived_at IS NOT NULL AND deleted_at IS NULL)
    OR (status = 'DELETED' AND deleted_at IS NOT NULL)
  ),
  CONSTRAINT projects_id_app_unique UNIQUE (id, app_id)
);

CREATE INDEX projects_owner_app_idx ON hive.projects (owner_user_id, app_id);
CREATE INDEX projects_app_created_idx ON hive.projects (app_id, created_at DESC);
CREATE INDEX projects_visible_idx ON hive.projects (owner_user_id, app_id, status);

COMMENT ON TABLE hive.projects IS
  'App-neutral project aggregate root, isolated by owner and trusted app context.';
