-- green_hive_migration: 0008
-- checkpoint: GH-0254,GH-0255,GH-0259
-- description: Create organization app installations and optional app-scoped memberships.
-- rollback_strategy: FORWARD_FIX_OR_VERIFIED_INSTALLATION_EXPORT_RESTORE

CREATE TABLE hive.organization_apps (
  organization_id uuid NOT NULL,
  app_id uuid NOT NULL,
  relationship text NOT NULL DEFAULT 'NATIVE',
  status text NOT NULL DEFAULT 'ACTIVE',
  installed_by_user_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  installed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, app_id),
  CONSTRAINT organization_apps_organization_fk
    FOREIGN KEY (organization_id) REFERENCES hive.organizations(id) ON DELETE CASCADE,
  CONSTRAINT organization_apps_app_fk
    FOREIGN KEY (app_id) REFERENCES hive.apps(id) ON DELETE RESTRICT,
  CONSTRAINT organization_apps_installer_membership_fk
    FOREIGN KEY (organization_id, installed_by_user_id)
    REFERENCES hive.organization_members(organization_id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT organization_apps_relationship_known CHECK (
    relationship IN ('NATIVE', 'CONNECTED', 'MIGRATING')
  ),
  CONSTRAINT organization_apps_status_known CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  CONSTRAINT organization_apps_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE TABLE hive.organization_app_members (
  organization_id uuid NOT NULL,
  app_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, app_id, user_id),
  CONSTRAINT organization_app_members_installation_fk
    FOREIGN KEY (organization_id, app_id)
    REFERENCES hive.organization_apps(organization_id, app_id)
    ON DELETE CASCADE,
  CONSTRAINT organization_app_members_workspace_membership_fk
    FOREIGN KEY (organization_id, user_id)
    REFERENCES hive.organization_members(organization_id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT organization_app_members_role_known CHECK (
    role IN ('APP_ADMIN', 'DEVELOPER', 'ANALYST', 'VIEWER')
  ),
  CONSTRAINT organization_app_members_status_known CHECK (status IN ('ACTIVE', 'SUSPENDED'))
);

CREATE INDEX organization_apps_app_idx
  ON hive.organization_apps (app_id, status, organization_id);
CREATE INDEX organization_app_members_user_idx
  ON hive.organization_app_members (user_id, status, organization_id, app_id);

INSERT INTO hive.organization_apps (
  organization_id,
  app_id,
  relationship,
  installed_by_user_id,
  metadata
)
SELECT DISTINCT
  organizations.id,
  projects.app_id,
  'NATIVE',
  projects.owner_user_id,
  jsonb_build_object('provisioned_by', 'migration-0008')
FROM hive.projects AS projects
JOIN hive.organizations AS organizations
  ON organizations.personal_owner_user_id = projects.owner_user_id;

COMMENT ON TABLE hive.organization_apps IS
  'Tenant installation of a global hive.apps definition. This identity is the future Billing ownership boundary.';
COMMENT ON TABLE hive.organization_app_members IS
  'Optional app-specific role narrowing for an existing active workspace member.';
