-- green_hive_migration: 0025
-- checkpoint: GH-0603
-- description: Permit a valid rendering-worker lease to create and complete one private generated document.
-- rollback_strategy: FORWARD_FIX_OR_VERIFIED_RENDERED_FILE_AND_JOB_EXPORT_RESTORE
-- Worker authority is restricted to the exact running lease, registered render job and entitled project.

CREATE FUNCTION hive.prepare_worker_rendered_file(
  target_job_id uuid, target_worker_id text, target_lease_token text,
  target_original_filename text, target_media_type text, target_byte_size bigint,
  target_content_sha256 text, target_storage_provider text, target_storage_bucket text
)
RETURNS TABLE (file_id uuid, storage_key text, status text, object_version text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE selected_job hive.jobs%ROWTYPE;
DECLARE selected_file hive.files%ROWTYPE;
DECLARE derived_idempotency text;
DECLARE derived_fingerprint text;
BEGIN
  IF target_job_id IS NULL OR target_worker_id IS NULL OR target_lease_token IS NULL
    OR target_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    OR target_lease_token !~ '^[0-9a-f-]{36}$'
    OR target_original_filename IS NULL OR char_length(target_original_filename) NOT BETWEEN 1 AND 180
    OR target_original_filename <> pg_catalog.btrim(target_original_filename)
    OR target_original_filename ~ '[[:cntrl:]/\\]' OR target_original_filename IN ('.', '..')
    OR target_media_type NOT IN ('text/plain', 'application/pdf')
    OR target_byte_size NOT BETWEEN 1 AND 10485760
    OR target_content_sha256 !~ '^[0-9a-f]{64}$'
    OR target_storage_provider !~ '^[A-Z][A-Z0-9_]{2,63}$'
    OR target_storage_bucket !~ '^[a-z0-9][a-z0-9._-]{2,62}$'
  THEN RAISE EXCEPTION 'WORKER_INVALID_INPUT' USING ERRCODE = 'P0001'; END IF;

  SELECT job.* INTO selected_job FROM hive.jobs AS job
  JOIN hive.job_registrations AS registration
    ON registration.id = job.job_registration_id AND registration.app_id = job.app_id
  WHERE job.id = target_job_id AND job.status = 'RUNNING'
    AND job.leased_by = target_worker_id
    AND job.lease_token_sha256 = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(target_lease_token, 'UTF8')), 'hex')
    AND job.lease_expires_at > pg_catalog.clock_timestamp()
    AND job.job_type = 'REFERENCE_APP_RENDER_PROJECT_DOCUMENT'
    AND registration.handler_owner = 'REFERENCE_APP'
    AND registration.required_capability = 'REFERENCE_APP_GENERATE_FILE'
    AND registration.active
  FOR SHARE;
  IF NOT FOUND OR NOT hive.can_project_capability(selected_job.project_id, 'REFERENCE_APP_GENERATE_FILE') THEN
    RAISE EXCEPTION 'WORKER_LEASE_LOST' USING ERRCODE = 'P0001';
  END IF;

  derived_idempotency := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(target_job_id::text || ':render', 'UTF8')), 'hex');
  derived_fingerprint := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    target_job_id::text || ':' || target_original_filename || ':' || target_media_type || ':' || target_byte_size::text || ':' || target_content_sha256, 'UTF8'
  )), 'hex');
  SELECT stored.* INTO selected_file FROM hive.files AS stored
  WHERE stored.project_id = selected_job.project_id AND stored.owner_user_id = selected_job.owner_user_id
    AND stored.app_id = selected_job.app_id AND stored.organization_id = selected_job.organization_id
    AND stored.idempotency_key_sha256 = derived_idempotency FOR SHARE;
  IF FOUND THEN
    IF selected_file.request_fingerprint_sha256 IS DISTINCT FROM derived_fingerprint OR selected_file.status = 'DELETED' THEN
      RAISE EXCEPTION 'FILE_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    INSERT INTO hive.files (
      organization_id, app_id, project_id, owner_user_id, original_filename, media_type, byte_size,
      sensitivity, storage_provider, storage_bucket, storage_key, content_sha256, required_capability,
      idempotency_key_sha256, request_fingerprint_sha256
    ) VALUES (
      selected_job.organization_id, selected_job.app_id, selected_job.project_id, selected_job.owner_user_id,
      target_original_filename, target_media_type, target_byte_size, 'INTERNAL', target_storage_provider,
      target_storage_bucket, 'ghf/' || pg_catalog.replace(gen_random_uuid()::text, '-', '') || pg_catalog.replace(gen_random_uuid()::text, '-', ''),
      target_content_sha256, 'REFERENCE_APP_GENERATE_FILE', derived_idempotency, derived_fingerprint
    ) RETURNING * INTO selected_file;
  END IF;
  RETURN QUERY SELECT selected_file.id, selected_file.storage_key, selected_file.status, selected_file.object_version;
END; $$;

CREATE FUNCTION hive.complete_worker_rendered_file(
  target_job_id uuid, target_worker_id text, target_lease_token text, target_file_id uuid, target_object_version text
)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE selected_job hive.jobs%ROWTYPE; DECLARE selected_file hive.files%ROWTYPE;
BEGIN
  IF target_job_id IS NULL OR target_worker_id IS NULL OR target_lease_token IS NULL OR target_file_id IS NULL
    OR target_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' OR target_lease_token !~ '^[0-9a-f-]{36}$'
    OR target_object_version IS NULL OR octet_length(target_object_version) NOT BETWEEN 1 AND 256 OR target_object_version ~ '[[:cntrl:]]'
  THEN RAISE EXCEPTION 'WORKER_INVALID_INPUT' USING ERRCODE = 'P0001'; END IF;
  SELECT job.* INTO selected_job FROM hive.jobs AS job WHERE job.id = target_job_id AND job.status = 'RUNNING'
    AND job.leased_by = target_worker_id AND job.lease_token_sha256 = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(target_lease_token, 'UTF8')), 'hex')
    AND job.lease_expires_at > pg_catalog.clock_timestamp() FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WORKER_LEASE_LOST' USING ERRCODE = 'P0001'; END IF;
  SELECT stored.* INTO selected_file FROM hive.files AS stored WHERE stored.id = target_file_id
    AND stored.project_id = selected_job.project_id AND stored.owner_user_id = selected_job.owner_user_id
    AND stored.app_id = selected_job.app_id AND stored.organization_id = selected_job.organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WORKER_LEASE_LOST' USING ERRCODE = 'P0001'; END IF;
  IF selected_file.status = 'READY' AND selected_file.object_version = target_object_version THEN RETURN true; END IF;
  IF selected_file.status <> 'PROCESSING' THEN RAISE EXCEPTION 'FILE_INVALID_TRANSITION' USING ERRCODE = 'P0001'; END IF;
  UPDATE hive.files SET status = 'READY', object_version = target_object_version, ready_at = statement_timestamp(), updated_at = statement_timestamp() WHERE id = selected_file.id;
  RETURN true;
END; $$;

CREATE FUNCTION hive.abort_worker_rendered_file(
  target_job_id uuid, target_worker_id text, target_lease_token text, target_file_id uuid
)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE selected_job hive.jobs%ROWTYPE; selected_file hive.files%ROWTYPE;
BEGIN
  IF target_job_id IS NULL OR target_worker_id IS NULL OR target_lease_token IS NULL OR target_file_id IS NULL
    OR target_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' OR target_lease_token !~ '^[0-9a-f-]{36}$'
  THEN RAISE EXCEPTION 'WORKER_INVALID_INPUT' USING ERRCODE = 'P0001'; END IF;
  SELECT job.* INTO selected_job FROM hive.jobs AS job WHERE job.id = target_job_id AND job.status = 'RUNNING'
    AND job.leased_by = target_worker_id AND job.lease_token_sha256 = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(target_lease_token, 'UTF8')), 'hex')
    AND job.lease_expires_at > pg_catalog.clock_timestamp() FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WORKER_LEASE_LOST' USING ERRCODE = 'P0001'; END IF;
  SELECT stored.* INTO selected_file FROM hive.files AS stored WHERE stored.id = target_file_id
    AND stored.project_id = selected_job.project_id AND stored.owner_user_id = selected_job.owner_user_id
    AND stored.app_id = selected_job.app_id AND stored.organization_id = selected_job.organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WORKER_LEASE_LOST' USING ERRCODE = 'P0001'; END IF;
  IF selected_file.status = 'PROCESSING' THEN
    DELETE FROM hive.files AS stored WHERE stored.id = selected_file.id AND stored.status = 'PROCESSING';
    RETURN true;
  END IF;
  IF selected_file.status = 'READY' THEN RETURN false; END IF;
  RAISE EXCEPTION 'FILE_INVALID_TRANSITION' USING ERRCODE = 'P0001';
END; $$;

REVOKE ALL ON FUNCTION hive.prepare_worker_rendered_file(uuid,text,text,text,text,bigint,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.complete_worker_rendered_file(uuid,text,text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.abort_worker_rendered_file(uuid,text,text,uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION hive.prepare_worker_rendered_file(uuid,text,text,text,text,bigint,text,text,text) FROM authenticated;
    REVOKE ALL ON FUNCTION hive.complete_worker_rendered_file(uuid,text,text,uuid,text) FROM authenticated;
    REVOKE ALL ON FUNCTION hive.abort_worker_rendered_file(uuid,text,text,uuid) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION hive.prepare_worker_rendered_file(uuid,text,text,text,text,bigint,text,text,text) TO service_role;
    GRANT EXECUTE ON FUNCTION hive.complete_worker_rendered_file(uuid,text,text,uuid,text) TO service_role;
    GRANT EXECUTE ON FUNCTION hive.abort_worker_rendered_file(uuid,text,text,uuid) TO service_role;
  END IF;
END $$;
