-- green_hive_migration: 0006
-- checkpoint: GH-0103,GH-0202-PARTIAL
-- description: Create trusted Supabase JWT context helpers and owner/admin RLS policies.
-- rollback_strategy: FORWARD_POLICY_FIX_OR_CONTROLLED_GRANT_REVOCATION

CREATE FUNCTION hive.current_app_code()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT nullif(auth.jwt() #>> '{app_metadata,app_code}', '');
$$;

CREATE FUNCTION hive.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    auth.jwt() #>> '{app_metadata,platform_role}' = 'PLATFORM_ADMIN',
    false
  );
$$;

CREATE FUNCTION hive.current_app_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT apps.id
  FROM hive.apps AS apps
  WHERE apps.app_code = hive.current_app_code()
    AND apps.status <> 'DISABLED';
$$;

CREATE FUNCTION hive.has_trusted_app_context()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL
    AND hive.current_app_id() IS NOT NULL;
$$;

CREATE FUNCTION hive.can_access_project(target_project_id uuid, target_app_id uuid)
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
      AND projects.app_id = hive.current_app_id()
      AND projects.owner_user_id = auth.uid()
      AND projects.status <> 'DELETED'
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
  IF hive.is_platform_admin() THEN
    RAISE EXCEPTION 'platform administrators are read-only'
      USING ERRCODE = '42501';
  END IF;

  UPDATE hive.projects
  SET
    status = 'DELETED',
    deleted_at = now(),
    updated_at = now()
  WHERE id = target_project_id
    AND owner_user_id = auth.uid()
    AND app_id = hive.current_app_id()
    AND status <> 'DELETED';

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows = 1;
END;
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA hive FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA hive FROM PUBLIC;

ALTER TABLE hive.apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.user_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.project_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.project_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY apps_admin_select
  ON hive.apps
  FOR SELECT
  USING (hive.is_platform_admin());

CREATE POLICY user_profiles_owner_select
  ON hive.user_profiles
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY user_profiles_admin_select
  ON hive.user_profiles
  FOR SELECT
  USING (hive.is_platform_admin());

CREATE POLICY user_profiles_owner_insert
  ON hive.user_profiles
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND NOT hive.is_platform_admin()
  );

CREATE POLICY user_profiles_owner_update
  ON hive.user_profiles
  FOR UPDATE
  USING (
    user_id = auth.uid()
    AND NOT hive.is_platform_admin()
  )
  WITH CHECK (
    user_id = auth.uid()
    AND NOT hive.is_platform_admin()
  );

CREATE POLICY projects_owner_select
  ON hive.projects
  FOR SELECT
  USING (
    owner_user_id = auth.uid()
    AND app_id = hive.current_app_id()
    AND status <> 'DELETED'
  );

CREATE POLICY projects_admin_select
  ON hive.projects
  FOR SELECT
  USING (hive.is_platform_admin());

CREATE POLICY projects_owner_insert
  ON hive.projects
  FOR INSERT
  WITH CHECK (
    owner_user_id = auth.uid()
    AND app_id = hive.current_app_id()
    AND status <> 'DELETED'
    AND NOT hive.is_platform_admin()
  );

CREATE POLICY projects_owner_update
  ON hive.projects
  FOR UPDATE
  USING (
    owner_user_id = auth.uid()
    AND app_id = hive.current_app_id()
    AND status <> 'DELETED'
    AND NOT hive.is_platform_admin()
  )
  WITH CHECK (
    owner_user_id = auth.uid()
    AND app_id = hive.current_app_id()
    AND status <> 'DELETED'
    AND NOT hive.is_platform_admin()
  );

CREATE POLICY project_settings_owner_select
  ON hive.project_settings
  FOR SELECT
  USING (hive.can_access_project(project_id, app_id));

CREATE POLICY project_settings_admin_select
  ON hive.project_settings
  FOR SELECT
  USING (hive.is_platform_admin());

CREATE POLICY project_settings_owner_insert
  ON hive.project_settings
  FOR INSERT
  WITH CHECK (
    hive.can_access_project(project_id, app_id)
    AND NOT hive.is_platform_admin()
  );

CREATE POLICY project_settings_owner_update
  ON hive.project_settings
  FOR UPDATE
  USING (
    hive.can_access_project(project_id, app_id)
    AND NOT hive.is_platform_admin()
  )
  WITH CHECK (
    hive.can_access_project(project_id, app_id)
    AND NOT hive.is_platform_admin()
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT USAGE ON SCHEMA hive TO authenticated;
    GRANT SELECT ON hive.apps TO authenticated;
    GRANT SELECT, INSERT, UPDATE
      ON hive.user_profiles, hive.projects, hive.project_settings
      TO authenticated;
    GRANT EXECUTE ON FUNCTION hive.current_app_code() TO authenticated;
    GRANT EXECUTE ON FUNCTION hive.is_platform_admin() TO authenticated;
    GRANT EXECUTE ON FUNCTION hive.current_app_id() TO authenticated;
    GRANT EXECUTE ON FUNCTION hive.has_trusted_app_context() TO authenticated;
    GRANT EXECUTE ON FUNCTION hive.can_access_project(uuid, uuid) TO authenticated;
    GRANT EXECUTE ON FUNCTION hive.soft_delete_project(uuid) TO authenticated;
  END IF;
END;
$$;
