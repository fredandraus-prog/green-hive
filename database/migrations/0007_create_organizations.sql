-- green_hive_migration: 0007
-- checkpoint: GH-0251,GH-0252,GH-0253
-- description: Create organizations and memberships, including backfill-safe personal workspaces.
-- rollback_strategy: FORWARD_FIX_OR_VERIFIED_ORGANIZATION_EXPORT_RESTORE

CREATE TABLE hive.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_by_user_id uuid NOT NULL,
  personal_owner_user_id uuid UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizations_creator_fk
    FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT organizations_personal_owner_fk
    FOREIGN KEY (personal_owner_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT organizations_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  CONSTRAINT organizations_slug_format CHECK (
    slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'
  ),
  CONSTRAINT organizations_kind_known CHECK (kind IN ('PERSONAL', 'SHARED')),
  CONSTRAINT organizations_status_known CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT organizations_personal_owner_consistent CHECK (
    (kind = 'PERSONAL' AND personal_owner_user_id IS NOT NULL)
    OR (kind = 'SHARED' AND personal_owner_user_id IS NULL)
  ),
  CONSTRAINT organizations_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE TABLE hive.organization_members (
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  joined_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id),
  CONSTRAINT organization_members_organization_fk
    FOREIGN KEY (organization_id) REFERENCES hive.organizations(id) ON DELETE CASCADE,
  CONSTRAINT organization_members_user_fk
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT organization_members_role_known CHECK (
    role IN ('OWNER', 'ADMIN', 'DEVELOPER', 'ANALYST', 'VIEWER')
  ),
  CONSTRAINT organization_members_status_known CHECK (status IN ('ACTIVE', 'SUSPENDED'))
);

CREATE INDEX organization_members_user_idx
  ON hive.organization_members (user_id, status, organization_id);
CREATE INDEX organizations_status_idx ON hive.organizations (status, kind);

WITH existing_users AS (
  SELECT user_id FROM hive.user_profiles
  UNION
  SELECT owner_user_id AS user_id FROM hive.projects
), inserted_organizations AS (
  INSERT INTO hive.organizations (
    name,
    slug,
    kind,
    created_by_user_id,
    personal_owner_user_id,
    metadata
  )
  SELECT
    'Personal Workspace',
    'personal-' || replace(existing_users.user_id::text, '-', ''),
    'PERSONAL',
    existing_users.user_id,
    existing_users.user_id,
    jsonb_build_object('provisioned_by', 'migration-0007')
  FROM existing_users
  RETURNING id, personal_owner_user_id
)
INSERT INTO hive.organization_members (organization_id, user_id, role)
SELECT id, personal_owner_user_id, 'OWNER'
FROM inserted_organizations;

COMMENT ON TABLE hive.organizations IS
  'Green Hive tenant boundary. A personal organization is provisioned once per participating user.';
COMMENT ON TABLE hive.organization_members IS
  'Workspace membership and tenant administration roles; membership alone never grants private project access.';
