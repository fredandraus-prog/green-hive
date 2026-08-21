-- green_hive_migration: 0009
-- checkpoint: GH-0254,GH-0256,GH-0259
-- description: Add immutable organization scope to projects and project settings.
-- rollback_strategy: FORWARD_FIX_OR_VERIFIED_TENANT_SCOPE_RESTORE

ALTER TABLE hive.projects ADD COLUMN organization_id uuid;

UPDATE hive.projects AS projects
SET organization_id = organizations.id
FROM hive.organizations AS organizations
WHERE organizations.personal_owner_user_id = projects.owner_user_id;

ALTER TABLE hive.projects ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE hive.projects
  ADD CONSTRAINT projects_organization_membership_fk
    FOREIGN KEY (organization_id, owner_user_id)
    REFERENCES hive.organization_members(organization_id, user_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT projects_organization_app_fk
    FOREIGN KEY (organization_id, app_id)
    REFERENCES hive.organization_apps(organization_id, app_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT projects_id_app_organization_unique
    UNIQUE (id, app_id, organization_id);

ALTER TABLE hive.project_settings ADD COLUMN organization_id uuid;

UPDATE hive.project_settings AS settings
SET organization_id = projects.organization_id
FROM hive.projects AS projects
WHERE projects.id = settings.project_id
  AND projects.app_id = settings.app_id;

ALTER TABLE hive.project_settings ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE hive.project_settings
  ADD CONSTRAINT project_settings_project_app_organization_fk
    FOREIGN KEY (project_id, app_id, organization_id)
    REFERENCES hive.projects(id, app_id, organization_id)
    ON DELETE CASCADE;

CREATE INDEX projects_organization_owner_app_idx
  ON hive.projects (organization_id, owner_user_id, app_id, status);
CREATE INDEX projects_organization_app_created_idx
  ON hive.projects (organization_id, app_id, created_at DESC);
CREATE INDEX project_settings_organization_app_idx
  ON hive.project_settings (organization_id, app_id);

COMMENT ON COLUMN hive.projects.organization_id IS
  'Immutable tenant boundary selected from an active trusted organization membership.';
COMMENT ON COLUMN hive.project_settings.organization_id IS
  'Organization copied from the parent project and enforced by a composite foreign key.';
