-- green_hive_migration: 0023
-- checkpoint: GH-0601
-- description: Create tenant-safe private generated-file metadata with server-only lifecycle writers.
-- rollback_strategy: FORWARD_FIX_OR_VERIFIED_PRIVATE_FILE_METADATA_EXPORT_RESTORE
-- Physical object references remain server-only; authenticated owners receive bounded metadata only.

CREATE TABLE hive.files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  app_id uuid NOT NULL,
  project_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'PROCESSING',
  original_filename text NOT NULL,
  media_type text NOT NULL,
  byte_size bigint NOT NULL,
  sensitivity text NOT NULL,
  storage_provider text NOT NULL,
  storage_bucket text NOT NULL,
  storage_key text NOT NULL,
  content_sha256 text NOT NULL,
  object_version text,
  required_capability text NOT NULL,
  idempotency_key_sha256 text NOT NULL,
  request_fingerprint_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  ready_at timestamptz,
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT files_project_scope_fk
    FOREIGN KEY (project_id, app_id, organization_id, owner_user_id)
    REFERENCES hive.projects(id, app_id, organization_id, owner_user_id)
    ON DELETE RESTRICT,
  CONSTRAINT files_id_scope_unique
    UNIQUE (id, organization_id, app_id, project_id, owner_user_id),
  CONSTRAINT files_idempotency_unique
    UNIQUE (organization_id, app_id, project_id, owner_user_id, idempotency_key_sha256),
  CONSTRAINT files_storage_identity_unique
    UNIQUE (storage_provider, storage_bucket, storage_key),
  CONSTRAINT files_status_check CHECK (
    status IN ('PROCESSING', 'READY', 'DELETED')
  ),
  CONSTRAINT files_original_filename_check CHECK (
    char_length(original_filename) BETWEEN 1 AND 180
    AND original_filename = pg_catalog.btrim(original_filename)
    AND original_filename NOT IN ('.', '..')
    AND pg_catalog.right(original_filename, 1) <> '.'
    AND original_filename !~ '[[:cntrl:]/\\]'
    AND pg_catalog.strpos(original_filename, U&'\202A') = 0
    AND pg_catalog.strpos(original_filename, U&'\202B') = 0
    AND pg_catalog.strpos(original_filename, U&'\202C') = 0
    AND pg_catalog.strpos(original_filename, U&'\202D') = 0
    AND pg_catalog.strpos(original_filename, U&'\202E') = 0
    AND pg_catalog.strpos(original_filename, U&'\2066') = 0
    AND pg_catalog.strpos(original_filename, U&'\2067') = 0
    AND pg_catalog.strpos(original_filename, U&'\2068') = 0
    AND pg_catalog.strpos(original_filename, U&'\2069') = 0
  ),
  CONSTRAINT files_media_type_check CHECK (
    char_length(media_type) BETWEEN 3 AND 255
    AND media_type ~ '^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$'
  ),
  CONSTRAINT files_byte_size_check CHECK (
    byte_size BETWEEN 1 AND 104857600
  ),
  CONSTRAINT files_sensitivity_check CHECK (
    sensitivity IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'HIGHLY_CONFIDENTIAL')
  ),
  CONSTRAINT files_storage_provider_check CHECK (
    storage_provider ~ '^[A-Z][A-Z0-9_]{2,63}$'
  ),
  CONSTRAINT files_storage_bucket_check CHECK (
    char_length(storage_bucket) BETWEEN 3 AND 63
    AND storage_bucket ~ '^[a-z0-9][a-z0-9._-]{2,62}$'
  ),
  CONSTRAINT files_storage_key_check CHECK (
    storage_key ~ '^ghf/[0-9a-f]{64}$'
  ),
  CONSTRAINT files_hashes_check CHECK (
    content_sha256 ~ '^[0-9a-f]{64}$'
    AND idempotency_key_sha256 ~ '^[0-9a-f]{64}$'
    AND request_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT files_required_capability_check CHECK (
    char_length(required_capability) BETWEEN 3 AND 128
    AND required_capability ~ '^[A-Z][A-Z0-9_]*$'
  ),
  CONSTRAINT files_object_version_check CHECK (
    object_version IS NULL OR (
      octet_length(object_version) BETWEEN 1 AND 256
      AND object_version !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT files_lifecycle_check CHECK (
    (
      status = 'PROCESSING'
      AND object_version IS NULL
      AND ready_at IS NULL
      AND deleted_at IS NULL
    ) OR (
      status = 'READY'
      AND object_version IS NOT NULL
      AND ready_at IS NOT NULL
      AND deleted_at IS NULL
    ) OR (
      status = 'DELETED'
      AND object_version IS NOT NULL
      AND ready_at IS NOT NULL
      AND deleted_at IS NOT NULL
    )
  )
);

CREATE INDEX files_owner_project_status_created_idx
  ON hive.files (
    organization_id, app_id, owner_user_id, project_id,
    status, created_at DESC, id DESC
  );

CREATE FUNCTION hive.prepare_generated_file(
  target_project_id uuid,
  target_idempotency_key_sha256 text,
  target_request_fingerprint_sha256 text,
  target_original_filename text,
  target_media_type text,
  target_byte_size bigint,
  target_sensitivity text,
  target_content_sha256 text,
  target_required_capability text,
  target_storage_provider text,
  target_storage_bucket text
)
RETURNS TABLE (
  file_id uuid,
  organization_id uuid,
  app_id uuid,
  project_id uuid,
  owner_user_id uuid,
  status text,
  original_filename text,
  media_type text,
  byte_size bigint,
  sensitivity text,
  storage_provider text,
  storage_bucket text,
  storage_key text,
  content_sha256 text,
  object_version text,
  required_capability text,
  idempotency_key_sha256 text,
  request_fingerprint_sha256 text,
  created_at timestamptz,
  ready_at timestamptz,
  deleted_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_user_id uuid := auth.uid();
  actor_app_id uuid := hive.current_app_id();
  actor_organization_id uuid := hive.current_organization_id();
  selected_project hive.projects%ROWTYPE;
  selected_app hive.apps%ROWTYPE;
  selected_file hive.files%ROWTYPE;
  created_file_id uuid;
BEGIN
  IF actor_user_id IS NULL
    OR actor_app_id IS NULL
    OR actor_organization_id IS NULL
    OR hive.is_platform_admin()
    OR NOT hive.has_trusted_organization_context()
  THEN
    RAISE EXCEPTION 'FILE_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  IF target_idempotency_key_sha256 IS NULL
    OR target_idempotency_key_sha256 !~ '^[0-9a-f]{64}$'
    OR target_request_fingerprint_sha256 IS NULL
    OR target_request_fingerprint_sha256 !~ '^[0-9a-f]{64}$'
    OR target_original_filename IS NULL
    OR char_length(target_original_filename) NOT BETWEEN 1 AND 180
    OR target_original_filename IS DISTINCT FROM pg_catalog.btrim(target_original_filename)
    OR target_original_filename IN ('.', '..')
    OR pg_catalog.right(target_original_filename, 1) = '.'
    OR target_original_filename ~ '[[:cntrl:]/\\]'
    OR pg_catalog.strpos(target_original_filename, U&'\202A') <> 0
    OR pg_catalog.strpos(target_original_filename, U&'\202B') <> 0
    OR pg_catalog.strpos(target_original_filename, U&'\202C') <> 0
    OR pg_catalog.strpos(target_original_filename, U&'\202D') <> 0
    OR pg_catalog.strpos(target_original_filename, U&'\202E') <> 0
    OR pg_catalog.strpos(target_original_filename, U&'\2066') <> 0
    OR pg_catalog.strpos(target_original_filename, U&'\2067') <> 0
    OR pg_catalog.strpos(target_original_filename, U&'\2068') <> 0
    OR pg_catalog.strpos(target_original_filename, U&'\2069') <> 0
    OR target_media_type IS NULL
    OR char_length(target_media_type) NOT BETWEEN 3 AND 255
    OR target_media_type !~ '^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$'
    OR target_byte_size IS NULL
    OR target_byte_size NOT BETWEEN 1 AND 104857600
    OR target_sensitivity IS NULL
    OR target_sensitivity NOT IN (
      'PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'HIGHLY_CONFIDENTIAL'
    )
    OR target_content_sha256 IS NULL
    OR target_content_sha256 !~ '^[0-9a-f]{64}$'
    OR target_required_capability IS NULL
    OR target_required_capability !~ '^[A-Z][A-Z0-9_]{2,127}$'
    OR pg_catalog.left(
      target_required_capability,
      pg_catalog.char_length(hive.current_app_code()) + 1
    ) IS DISTINCT FROM hive.current_app_code() || '_'
    OR target_storage_provider IS NULL
    OR target_storage_provider !~ '^[A-Z][A-Z0-9_]{2,63}$'
    OR target_storage_bucket IS NULL
    OR char_length(target_storage_bucket) NOT BETWEEN 3 AND 63
    OR target_storage_bucket !~ '^[a-z0-9][a-z0-9._-]{2,62}$'
  THEN
    RAISE EXCEPTION 'FILE_INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;

  SELECT project.* INTO selected_project
  FROM hive.projects AS project
  WHERE project.id = target_project_id
    AND project.organization_id = actor_organization_id
    AND project.app_id = actor_app_id
    AND project.owner_user_id = actor_user_id
    AND project.status IN ('DRAFT', 'ACTIVE')
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FILE_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  SELECT app.* INTO selected_app
  FROM hive.apps AS app
  WHERE app.id = actor_app_id
    AND app.status <> 'DISABLED';

  IF NOT FOUND OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements_text(
      selected_app.manifest -> 'requiredCapabilities'
    ) AS declared(capability_code)
    WHERE declared.capability_code = 'FILES'
  ) THEN
    RAISE EXCEPTION 'FILE_CONFIGURATION_INVALID' USING ERRCODE = 'P0001';
  END IF;

  IF NOT hive.can_project_capability(
    selected_project.id,
    target_required_capability
  ) THEN
    RAISE EXCEPTION 'FILE_ENTITLEMENT_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT stored.* INTO selected_file
  FROM hive.files AS stored
  WHERE stored.organization_id = actor_organization_id
    AND stored.app_id = actor_app_id
    AND stored.project_id = selected_project.id
    AND stored.owner_user_id = actor_user_id
    AND stored.idempotency_key_sha256 = target_idempotency_key_sha256
  FOR SHARE;

  IF FOUND THEN
    IF selected_file.request_fingerprint_sha256
        IS DISTINCT FROM target_request_fingerprint_sha256
    THEN
      RAISE EXCEPTION 'FILE_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    IF selected_file.status = 'DELETED' THEN
      RAISE EXCEPTION 'FILE_INVALID_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY
    SELECT
      selected_file.id, selected_file.organization_id, selected_file.app_id,
      selected_file.project_id, selected_file.owner_user_id, selected_file.status,
      selected_file.original_filename, selected_file.media_type, selected_file.byte_size,
      selected_file.sensitivity, selected_file.storage_provider,
      selected_file.storage_bucket, selected_file.storage_key, selected_file.content_sha256,
      selected_file.object_version, selected_file.required_capability,
      selected_file.idempotency_key_sha256, selected_file.request_fingerprint_sha256,
      selected_file.created_at, selected_file.ready_at,
      selected_file.deleted_at, selected_file.updated_at;
    RETURN;
  END IF;

  INSERT INTO hive.files (
    organization_id, app_id, project_id, owner_user_id,
    original_filename, media_type, byte_size, sensitivity,
    storage_provider, storage_bucket, storage_key, content_sha256,
    required_capability, idempotency_key_sha256, request_fingerprint_sha256
  ) VALUES (
    actor_organization_id, actor_app_id, selected_project.id, actor_user_id,
    target_original_filename, target_media_type, target_byte_size, target_sensitivity,
    target_storage_provider, target_storage_bucket,
    'ghf/'
      || pg_catalog.replace(gen_random_uuid()::text, '-', '')
      || pg_catalog.replace(gen_random_uuid()::text, '-', ''),
    target_content_sha256, target_required_capability,
    target_idempotency_key_sha256, target_request_fingerprint_sha256
  )
  ON CONFLICT ON CONSTRAINT files_idempotency_unique DO NOTHING
  RETURNING id INTO created_file_id;

  IF created_file_id IS NULL THEN
    SELECT stored.* INTO selected_file
    FROM hive.files AS stored
    WHERE stored.organization_id = actor_organization_id
      AND stored.app_id = actor_app_id
      AND stored.project_id = selected_project.id
      AND stored.owner_user_id = actor_user_id
      AND stored.idempotency_key_sha256 = target_idempotency_key_sha256
    FOR SHARE;

    IF NOT FOUND
      OR selected_file.request_fingerprint_sha256
        IS DISTINCT FROM target_request_fingerprint_sha256
    THEN
      RAISE EXCEPTION 'FILE_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    IF selected_file.status = 'DELETED' THEN
      RAISE EXCEPTION 'FILE_INVALID_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    SELECT stored.* INTO selected_file
    FROM hive.files AS stored
    WHERE stored.id = created_file_id;
  END IF;

  RETURN QUERY
  SELECT
    selected_file.id, selected_file.organization_id, selected_file.app_id,
    selected_file.project_id, selected_file.owner_user_id, selected_file.status,
    selected_file.original_filename, selected_file.media_type, selected_file.byte_size,
    selected_file.sensitivity, selected_file.storage_provider,
    selected_file.storage_bucket, selected_file.storage_key, selected_file.content_sha256,
    selected_file.object_version, selected_file.required_capability,
    selected_file.idempotency_key_sha256, selected_file.request_fingerprint_sha256,
    selected_file.created_at, selected_file.ready_at,
    selected_file.deleted_at, selected_file.updated_at;
END;
$$;

CREATE FUNCTION hive.complete_generated_file(
  target_file_id uuid,
  target_object_version text
)
RETURNS TABLE (
  file_id uuid,
  organization_id uuid,
  app_id uuid,
  project_id uuid,
  owner_user_id uuid,
  status text,
  original_filename text,
  media_type text,
  byte_size bigint,
  sensitivity text,
  storage_provider text,
  storage_bucket text,
  storage_key text,
  content_sha256 text,
  object_version text,
  required_capability text,
  idempotency_key_sha256 text,
  request_fingerprint_sha256 text,
  created_at timestamptz,
  ready_at timestamptz,
  deleted_at timestamptz,
  updated_at timestamptz
)
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

  IF target_file_id IS NULL
    OR target_object_version IS NULL
    OR octet_length(target_object_version) NOT BETWEEN 1 AND 256
    OR target_object_version ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'FILE_INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;

  SELECT stored.* INTO selected_file
  FROM hive.files AS stored
  WHERE stored.id = target_file_id
    AND stored.organization_id = actor_organization_id
    AND stored.app_id = actor_app_id
    AND stored.owner_user_id = actor_user_id
  FOR UPDATE;

  IF NOT FOUND OR NOT hive.can_access_project(
    selected_file.project_id, selected_file.app_id, selected_file.organization_id
  ) THEN
    RAISE EXCEPTION 'FILE_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  IF selected_file.status = 'READY' THEN
    IF selected_file.object_version IS DISTINCT FROM target_object_version THEN
      RAISE EXCEPTION 'FILE_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
  ELSIF selected_file.status = 'PROCESSING' THEN
    UPDATE hive.files AS stored
    SET status = 'READY',
        object_version = target_object_version,
        ready_at = statement_timestamp(),
        updated_at = statement_timestamp()
    WHERE stored.id = selected_file.id
    RETURNING stored.* INTO selected_file;
  ELSE
    RAISE EXCEPTION 'FILE_INVALID_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    selected_file.id, selected_file.organization_id, selected_file.app_id,
    selected_file.project_id, selected_file.owner_user_id, selected_file.status,
    selected_file.original_filename, selected_file.media_type, selected_file.byte_size,
    selected_file.sensitivity, selected_file.storage_provider,
    selected_file.storage_bucket, selected_file.storage_key, selected_file.content_sha256,
    selected_file.object_version, selected_file.required_capability,
    selected_file.idempotency_key_sha256, selected_file.request_fingerprint_sha256,
    selected_file.created_at, selected_file.ready_at,
    selected_file.deleted_at, selected_file.updated_at;
END;
$$;

CREATE FUNCTION hive.abort_generated_file(target_file_id uuid)
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

  IF target_file_id IS NULL THEN
    RAISE EXCEPTION 'FILE_INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;

  SELECT stored.* INTO selected_file
  FROM hive.files AS stored
  WHERE stored.id = target_file_id
    AND stored.organization_id = actor_organization_id
    AND stored.app_id = actor_app_id
    AND stored.owner_user_id = actor_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF NOT hive.can_access_project(
    selected_file.project_id, selected_file.app_id, selected_file.organization_id
  ) THEN
    RAISE EXCEPTION 'FILE_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  IF selected_file.status <> 'PROCESSING' THEN
    RAISE EXCEPTION 'FILE_INVALID_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM hive.files AS stored WHERE stored.id = selected_file.id;
  RETURN true;
END;
$$;

CREATE FUNCTION hive.soft_delete_file(target_file_id uuid)
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

  IF target_file_id IS NULL THEN
    RAISE EXCEPTION 'FILE_INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;

  SELECT stored.* INTO selected_file
  FROM hive.files AS stored
  WHERE stored.id = target_file_id
    AND stored.organization_id = actor_organization_id
    AND stored.app_id = actor_app_id
    AND stored.owner_user_id = actor_user_id
  FOR UPDATE;

  IF NOT FOUND OR NOT hive.can_access_project(
    selected_file.project_id, selected_file.app_id, selected_file.organization_id
  ) THEN
    RAISE EXCEPTION 'FILE_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  IF selected_file.status = 'DELETED' THEN
    RETURN true;
  END IF;
  IF selected_file.status <> 'READY' THEN
    RAISE EXCEPTION 'FILE_INVALID_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  UPDATE hive.files AS stored
  SET status = 'DELETED',
      deleted_at = statement_timestamp(),
      updated_at = statement_timestamp()
  WHERE stored.id = selected_file.id;

  RETURN true;
END;
$$;

REVOKE ALL ON hive.files FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.prepare_generated_file(
  uuid, text, text, text, text, bigint, text, text, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.complete_generated_file(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.abort_generated_file(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.soft_delete_file(uuid) FROM PUBLIC;

ALTER TABLE hive.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.files FORCE ROW LEVEL SECURITY;

CREATE POLICY files_owner_select
  ON hive.files
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND organization_id = hive.current_organization_id()
    AND app_id = hive.current_app_id()
    AND owner_user_id = auth.uid()
    AND status <> 'DELETED'
    AND hive.has_trusted_organization_context()
    AND hive.can_access_project(project_id, app_id, organization_id)
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT (
      id, organization_id, app_id, project_id, owner_user_id, status,
      original_filename, media_type, byte_size, sensitivity,
      created_at, ready_at, deleted_at, updated_at
    ) ON hive.files TO authenticated;
    REVOKE ALL ON FUNCTION hive.prepare_generated_file(
      uuid, text, text, text, text, bigint, text, text, text, text, text
    ) FROM authenticated;
    REVOKE ALL ON FUNCTION hive.complete_generated_file(uuid, text) FROM authenticated;
    REVOKE ALL ON FUNCTION hive.abort_generated_file(uuid) FROM authenticated;
    REVOKE ALL ON FUNCTION hive.soft_delete_file(uuid) FROM authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA hive TO service_role;
    GRANT EXECUTE ON FUNCTION hive.prepare_generated_file(
      uuid, text, text, text, text, bigint, text, text, text, text, text
    ) TO service_role;
    GRANT EXECUTE ON FUNCTION hive.complete_generated_file(uuid, text) TO service_role;
    GRANT EXECUTE ON FUNCTION hive.abort_generated_file(uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION hive.soft_delete_file(uuid) TO service_role;
  END IF;
END;
$$;

COMMENT ON TABLE hive.files IS
  'Tenant-safe metadata for private generated objects; physical references remain server-only.';
COMMENT ON FUNCTION hive.prepare_generated_file(
  uuid, text, text, text, text, bigint, text, text, text, text, text
) IS 'Server-only idempotent preparation of one private generated-file identity and opaque storage key.';
COMMENT ON FUNCTION hive.complete_generated_file(uuid, text) IS
  'Server-only idempotent PROCESSING-to-READY transition after private object persistence.';
COMMENT ON FUNCTION hive.abort_generated_file(uuid) IS
  'Server-only compensating physical removal of metadata that is still PROCESSING.';
COMMENT ON FUNCTION hive.soft_delete_file(uuid) IS
  'Server-only idempotent logical deletion of READY private-file metadata.';
