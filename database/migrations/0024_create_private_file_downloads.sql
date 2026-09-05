-- green_hive_migration: 0024
-- checkpoint: GH-0602
-- description: Declare the private generated-files bucket and authorize auditable short-lived download grants.
-- rollback_strategy: FORWARD_FIX_OR_VERIFIED_PRIVATE_FILE_DELIVERY_AUDIT_EXPORT
-- Signed URLs are minted only by the server-side provider after this database authorization is rechecked.

DO $$
DECLARE
  configured_bucket record;
BEGIN
  IF pg_catalog.to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION 'Supabase Storage bucket catalog is required for GH-0602';
  END IF;

  SELECT bucket.* INTO configured_bucket
  FROM storage.buckets AS bucket
  WHERE bucket.id = 'green-hive-generated'
  FOR UPDATE;

  IF FOUND THEN
    IF configured_bucket.name IS DISTINCT FROM 'green-hive-generated'
      OR configured_bucket.public IS DISTINCT FROM false
    THEN
      RAISE EXCEPTION 'green-hive-generated storage bucket has incompatible privacy configuration';
    END IF;
  ELSE
    -- This controlled declaration is the sole idempotent clause in this migration:
    -- an already-existing bucket must match the exact private configuration above.
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('green-hive-generated', 'green-hive-generated', false);
  END IF;
END;
$$;

ALTER TABLE audit.events
  DROP CONSTRAINT audit_events_subject_type_check;

ALTER TABLE audit.events
  ADD CONSTRAINT audit_events_subject_type_check CHECK (
    subject_type IN (
      'AUTHENTICATION', 'ORGANIZATION', 'ORGANIZATION_MEMBER',
      'ORGANIZATION_APP', 'PROJECT', 'PURCHASE', 'PAYMENT', 'ENTITLEMENT',
      'USAGE_BUDGET', 'COST_GUARD_DECISION', 'JOB', 'AI_OPERATION',
      'SEARCH_OPERATION', 'FILE', 'PLATFORM'
    )
  );

CREATE FUNCTION hive.record_file_export(
  target_project_id uuid,
  target_file_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_user_id uuid := auth.uid();
  actor_app_id uuid := hive.current_app_id();
  actor_organization_id uuid := hive.current_organization_id();
  selected_file hive.files%ROWTYPE;
BEGIN
  IF actor_user_id IS NULL
    OR actor_app_id IS NULL
    OR actor_organization_id IS NULL
    OR hive.is_platform_admin()
    OR NOT hive.has_trusted_organization_context()
  THEN
    RAISE EXCEPTION 'FILE_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  IF target_project_id IS NULL OR target_file_id IS NULL THEN
    RAISE EXCEPTION 'FILE_INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;

  SELECT stored.* INTO selected_file
  FROM hive.files AS stored
  WHERE stored.id = target_file_id
    AND stored.project_id = target_project_id
    AND stored.organization_id = actor_organization_id
    AND stored.app_id = actor_app_id
    AND stored.owner_user_id = actor_user_id
    AND stored.status = 'READY'
  FOR SHARE;

  IF NOT FOUND OR NOT hive.can_access_project(
    selected_file.project_id, selected_file.app_id, selected_file.organization_id
  ) THEN
    RAISE EXCEPTION 'FILE_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  PERFORM audit.append_core_event(
    'FILE_EXPORTED',
    selected_file.organization_id,
    selected_file.app_id,
    selected_file.project_id,
    'FILE',
    selected_file.id,
    pg_catalog.jsonb_build_object(
      'byteSize', selected_file.byte_size,
      'mediaType', selected_file.media_type,
      'sensitivity', selected_file.sensitivity
    )
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION hive.record_file_export(uuid, uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION hive.record_file_export(uuid, uuid) FROM authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA hive TO service_role;
    GRANT EXECUTE ON FUNCTION hive.record_file_export(uuid, uuid) TO service_role;
  END IF;
END;
$$;

COMMENT ON FUNCTION hive.record_file_export(uuid, uuid) IS
  'Server-only recheck and audit capture after a private signed download URL is minted but before it is returned.';
