-- green_hive_migration: 0010
-- checkpoint: GH-0253,GH-0256,GH-0258,GH-0202-PARTIAL
-- description: Create trusted organization selection, workspace provisioning and tenant-aware RLS.
-- rollback_strategy: FORWARD_POLICY_FIX_OR_CONTROLLED_TENANT_GRANT_REVOCATION

CREATE FUNCTION hive.requested_organization_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  raw_organization_id text;
BEGIN
  raw_organization_id := current_setting('request.green_hive.organization_id', true);
  IF raw_organization_id IS NULL OR btrim(raw_organization_id) = '' THEN
    RETURN NULL;
  END IF;
  BEGIN
    RETURN raw_organization_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;
END;
$$;

CREATE FUNCTION hive.current_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT members.organization_id
  FROM hive.organization_members AS members
  JOIN hive.organizations AS organizations ON organizations.id = members.organization_id
  WHERE members.organization_id = hive.requested_organization_id()
    AND members.user_id = auth.uid()
    AND members.status = 'ACTIVE'
    AND organizations.status = 'ACTIVE';
$$;

CREATE FUNCTION hive.has_organization_role(target_organization_id uuid, allowed_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM hive.organization_members AS members
    JOIN hive.organizations AS organizations ON organizations.id = members.organization_id
    WHERE members.organization_id = target_organization_id
      AND members.user_id = auth.uid()
      AND members.status = 'ACTIVE'
      AND members.role = ANY(allowed_roles)
      AND organizations.status = 'ACTIVE'
  );
$$;

CREATE FUNCTION hive.has_trusted_organization_context()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL
    AND hive.current_organization_id() IS NOT NULL
    AND hive.current_app_id() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM hive.organization_apps AS installations
      WHERE installations.organization_id = hive.current_organization_id()
        AND installations.app_id = hive.current_app_id()
        AND installations.status = 'ACTIVE'
    );
$$;

CREATE FUNCTION hive.ensure_personal_organization(workspace_name text DEFAULT 'Personal Workspace')
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id uuid;
  current_application_id uuid;
  personal_organization_id uuid;
  normalized_name text;
BEGIN
  current_user_id := auth.uid();
  current_application_id := hive.current_app_id();
  normalized_name := btrim(workspace_name);

  IF current_user_id IS NULL OR current_application_id IS NULL OR hive.is_platform_admin() THEN
    RAISE EXCEPTION 'trusted user and app context required' USING ERRCODE = '42501';
  END IF;
  IF char_length(normalized_name) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'workspace name is invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO hive.organizations (
    name,
    slug,
    kind,
    created_by_user_id,
    personal_owner_user_id
  )
  VALUES (
    normalized_name,
    'personal-' || replace(current_user_id::text, '-', ''),
    'PERSONAL',
    current_user_id,
    current_user_id
  )
  ON CONFLICT (personal_owner_user_id) DO UPDATE
    SET updated_at = hive.organizations.updated_at
  RETURNING id INTO personal_organization_id;

  INSERT INTO hive.organization_members (organization_id, user_id, role)
  VALUES (personal_organization_id, current_user_id, 'OWNER')
  ON CONFLICT (organization_id, user_id) DO UPDATE
    SET
      role = 'OWNER',
      status = 'ACTIVE',
      updated_at = now();

  INSERT INTO hive.organization_apps (
    organization_id,
    app_id,
    relationship,
    installed_by_user_id
  )
  VALUES (personal_organization_id, current_application_id, 'NATIVE', current_user_id)
  ON CONFLICT (organization_id, app_id) DO UPDATE
    SET
      status = 'ACTIVE',
      updated_at = now();

  RETURN personal_organization_id;
END;
$$;

CREATE FUNCTION hive.create_shared_organization(workspace_name text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id uuid;
  current_application_id uuid;
  shared_organization_id uuid;
  normalized_name text;
BEGIN
  current_user_id := auth.uid();
  current_application_id := hive.current_app_id();
  normalized_name := btrim(workspace_name);

  IF current_user_id IS NULL OR current_application_id IS NULL OR hive.is_platform_admin() THEN
    RAISE EXCEPTION 'trusted user and app context required' USING ERRCODE = '42501';
  END IF;
  IF char_length(normalized_name) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'workspace name is invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO hive.organizations (name, slug, kind, created_by_user_id)
  VALUES (
    normalized_name,
    'workspace-' || replace(gen_random_uuid()::text, '-', ''),
    'SHARED',
    current_user_id
  )
  RETURNING id INTO shared_organization_id;

  INSERT INTO hive.organization_members (organization_id, user_id, role)
  VALUES (shared_organization_id, current_user_id, 'OWNER');

  INSERT INTO hive.organization_apps (
    organization_id,
    app_id,
    relationship,
    installed_by_user_id
  )
  VALUES (shared_organization_id, current_application_id, 'NATIVE', current_user_id);

  RETURN shared_organization_id;
END;
$$;

DROP POLICY user_profiles_admin_select ON hive.user_profiles;
DROP POLICY projects_admin_select ON hive.projects;
DROP POLICY projects_owner_select ON hive.projects;
DROP POLICY projects_owner_insert ON hive.projects;
DROP POLICY projects_owner_update ON hive.projects;
DROP POLICY project_settings_admin_select ON hive.project_settings;
DROP POLICY project_settings_owner_select ON hive.project_settings;
DROP POLICY project_settings_owner_insert ON hive.project_settings;
DROP POLICY project_settings_owner_update ON hive.project_settings;

DROP FUNCTION hive.can_access_project(uuid, uuid);
DROP FUNCTION hive.soft_delete_project(uuid);

CREATE FUNCTION hive.can_access_project(
  target_project_id uuid,
  target_app_id uuid,
  target_organization_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM hive.projects AS projects
    WHERE projects.id = target_project_id
      AND projects.app_id = target_app_id
      AND projects.organization_id = target_organization_id
      AND projects.organization_id = hive.current_organization_id()
      AND projects.app_id = hive.current_app_id()
      AND projects.owner_user_id = auth.uid()
      AND projects.status <> 'DELETED'
      AND hive.has_trusted_organization_context()
  );
$$;

CREATE FUNCTION hive.soft_delete_project(target_project_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  affected_rows integer;
BEGIN
  IF hive.is_platform_admin() OR NOT hive.has_trusted_organization_context() THEN
    RAISE EXCEPTION 'project deletion is not permitted' USING ERRCODE = '42501';
  END IF;

  UPDATE hive.projects
  SET
    status = 'DELETED',
    deleted_at = now(),
    updated_at = now()
  WHERE id = target_project_id
    AND organization_id = hive.current_organization_id()
    AND owner_user_id = auth.uid()
    AND app_id = hive.current_app_id()
    AND status <> 'DELETED';

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows = 1;
END;
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA hive FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA hive FROM PUBLIC;

ALTER TABLE hive.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.organization_members FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.organization_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.organization_apps FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.organization_app_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.organization_app_members FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.projects FORCE ROW LEVEL SECURITY;

CREATE POLICY organizations_member_or_platform_select
  ON hive.organizations
  FOR SELECT
  USING (
    hive.is_platform_admin()
    OR hive.has_organization_role(id, ARRAY['OWNER', 'ADMIN', 'DEVELOPER', 'ANALYST', 'VIEWER'])
  );

CREATE POLICY organizations_admin_update
  ON hive.organizations
  FOR UPDATE
  USING (
    NOT hive.is_platform_admin()
    AND kind = 'SHARED'
    AND hive.has_organization_role(id, ARRAY['OWNER', 'ADMIN'])
  )
  WITH CHECK (
    NOT hive.is_platform_admin()
    AND kind = 'SHARED'
    AND hive.has_organization_role(id, ARRAY['OWNER', 'ADMIN'])
  );

CREATE POLICY organization_members_member_or_platform_select
  ON hive.organization_members
  FOR SELECT
  USING (
    hive.is_platform_admin()
    OR hive.has_organization_role(
      organization_id,
      ARRAY['OWNER', 'ADMIN', 'DEVELOPER', 'ANALYST', 'VIEWER']
    )
  );

CREATE POLICY organization_members_admin_insert
  ON hive.organization_members
  FOR INSERT
  WITH CHECK (
    NOT hive.is_platform_admin()
    AND role <> 'OWNER'
    AND hive.has_organization_role(organization_id, ARRAY['OWNER', 'ADMIN'])
  );

CREATE POLICY organization_members_admin_update
  ON hive.organization_members
  FOR UPDATE
  USING (
    NOT hive.is_platform_admin()
    AND role <> 'OWNER'
    AND hive.has_organization_role(organization_id, ARRAY['OWNER', 'ADMIN'])
  )
  WITH CHECK (
    role <> 'OWNER'
    AND hive.has_organization_role(organization_id, ARRAY['OWNER', 'ADMIN'])
  );

CREATE POLICY organization_apps_member_or_platform_select
  ON hive.organization_apps
  FOR SELECT
  USING (
    hive.is_platform_admin()
    OR hive.has_organization_role(
      organization_id,
      ARRAY['OWNER', 'ADMIN', 'DEVELOPER', 'ANALYST', 'VIEWER']
    )
  );

CREATE POLICY organization_apps_admin_insert
  ON hive.organization_apps
  FOR INSERT
  WITH CHECK (
    NOT hive.is_platform_admin()
    AND installed_by_user_id = auth.uid()
    AND app_id = hive.current_app_id()
    AND hive.has_organization_role(organization_id, ARRAY['OWNER', 'ADMIN'])
  );

CREATE POLICY organization_apps_admin_update
  ON hive.organization_apps
  FOR UPDATE
  USING (
    NOT hive.is_platform_admin()
    AND hive.has_organization_role(organization_id, ARRAY['OWNER', 'ADMIN'])
  )
  WITH CHECK (
    app_id = hive.current_app_id()
    AND hive.has_organization_role(organization_id, ARRAY['OWNER', 'ADMIN'])
  );

CREATE POLICY organization_app_members_member_or_platform_select
  ON hive.organization_app_members
  FOR SELECT
  USING (
    hive.is_platform_admin()
    OR hive.has_organization_role(
      organization_id,
      ARRAY['OWNER', 'ADMIN', 'DEVELOPER', 'ANALYST', 'VIEWER']
    )
  );

CREATE POLICY organization_app_members_admin_insert
  ON hive.organization_app_members
  FOR INSERT
  WITH CHECK (
    NOT hive.is_platform_admin()
    AND app_id = hive.current_app_id()
    AND hive.has_organization_role(organization_id, ARRAY['OWNER', 'ADMIN'])
  );

CREATE POLICY organization_app_members_admin_update
  ON hive.organization_app_members
  FOR UPDATE
  USING (
    NOT hive.is_platform_admin()
    AND app_id = hive.current_app_id()
    AND hive.has_organization_role(organization_id, ARRAY['OWNER', 'ADMIN'])
  )
  WITH CHECK (
    app_id = hive.current_app_id()
    AND hive.has_organization_role(organization_id, ARRAY['OWNER', 'ADMIN'])
  );

CREATE POLICY projects_tenant_owner_select
  ON hive.projects
  FOR SELECT
  USING (
    organization_id = hive.current_organization_id()
    AND owner_user_id = auth.uid()
    AND app_id = hive.current_app_id()
    AND status <> 'DELETED'
    AND hive.has_trusted_organization_context()
  );

CREATE POLICY projects_tenant_owner_insert
  ON hive.projects
  FOR INSERT
  WITH CHECK (
    organization_id = hive.current_organization_id()
    AND owner_user_id = auth.uid()
    AND app_id = hive.current_app_id()
    AND status <> 'DELETED'
    AND NOT hive.is_platform_admin()
    AND hive.has_trusted_organization_context()
  );

CREATE POLICY projects_tenant_owner_update
  ON hive.projects
  FOR UPDATE
  USING (
    organization_id = hive.current_organization_id()
    AND owner_user_id = auth.uid()
    AND app_id = hive.current_app_id()
    AND status <> 'DELETED'
    AND NOT hive.is_platform_admin()
    AND hive.has_trusted_organization_context()
  )
  WITH CHECK (
    organization_id = hive.current_organization_id()
    AND owner_user_id = auth.uid()
    AND app_id = hive.current_app_id()
    AND status <> 'DELETED'
    AND NOT hive.is_platform_admin()
    AND hive.has_trusted_organization_context()
  );

CREATE POLICY project_settings_tenant_owner_select
  ON hive.project_settings
  FOR SELECT
  USING (hive.can_access_project(project_id, app_id, organization_id));

CREATE POLICY project_settings_tenant_owner_insert
  ON hive.project_settings
  FOR INSERT
  WITH CHECK (
    hive.can_access_project(project_id, app_id, organization_id)
    AND NOT hive.is_platform_admin()
  );

CREATE POLICY project_settings_tenant_owner_update
  ON hive.project_settings
  FOR UPDATE
  USING (
    hive.can_access_project(project_id, app_id, organization_id)
    AND NOT hive.is_platform_admin()
  )
  WITH CHECK (
    hive.can_access_project(project_id, app_id, organization_id)
    AND NOT hive.is_platform_admin()
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT, UPDATE ON hive.organizations TO authenticated;
    GRANT SELECT, INSERT, UPDATE ON hive.organization_members TO authenticated;
    GRANT SELECT, INSERT, UPDATE ON hive.organization_apps TO authenticated;
    GRANT SELECT, INSERT, UPDATE ON hive.organization_app_members TO authenticated;
    GRANT EXECUTE ON FUNCTION hive.requested_organization_id() TO authenticated;
    GRANT EXECUTE ON FUNCTION hive.current_organization_id() TO authenticated;
    GRANT EXECUTE ON FUNCTION hive.has_organization_role(uuid, text[]) TO authenticated;
    GRANT EXECUTE ON FUNCTION hive.has_trusted_organization_context() TO authenticated;
    GRANT EXECUTE ON FUNCTION hive.ensure_personal_organization(text) TO authenticated;
    GRANT EXECUTE ON FUNCTION hive.create_shared_organization(text) TO authenticated;
    GRANT EXECUTE ON FUNCTION hive.can_access_project(uuid, uuid, uuid) TO authenticated;
    GRANT EXECUTE ON FUNCTION hive.soft_delete_project(uuid) TO authenticated;
  END IF;
END;
$$;
