-- green_hive_migration: 0020
-- checkpoint: GH-0404
-- description: Add an exclusive leased worker lifecycle with deterministic retry and expired-lease recovery.
-- rollback_strategy: FORWARD_FIX_OR_VERIFIED_JOB_WORKER_EXPORT_RESTORE
-- Lease tokens are returned once to service-role workers; only their SHA-256 digests are persisted.

ALTER TABLE hive.jobs
  ADD COLUMN leased_by text,
  ADD COLUMN lease_token_sha256 text,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN heartbeat_at timestamptz,
  ADD COLUMN output_reference text,
  ADD COLUMN output_sha256 text;

ALTER TABLE hive.jobs
  ADD CONSTRAINT jobs_leased_by_check CHECK (
    leased_by IS NULL OR leased_by ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  ADD CONSTRAINT jobs_lease_token_sha256_check CHECK (
    lease_token_sha256 IS NULL OR lease_token_sha256 ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT jobs_output_reference_check CHECK (
    output_reference IS NULL OR (
      char_length(output_reference) BETWEEN 1 AND 512
      AND output_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
    )
  ),
  ADD CONSTRAINT jobs_output_sha256_check CHECK (
    output_sha256 IS NULL OR output_sha256 ~ '^[0-9a-f]{64}$'
  );

ALTER TABLE hive.jobs DROP CONSTRAINT jobs_lifecycle_check;
ALTER TABLE hive.jobs ADD CONSTRAINT jobs_lifecycle_check CHECK (
  (
    status = 'QUEUED' AND attempt_count = 0 AND safe_error_code IS NULL
    AND started_at IS NULL AND completed_at IS NULL AND failed_at IS NULL
    AND cancelled_at IS NULL AND leased_by IS NULL AND lease_token_sha256 IS NULL
    AND lease_expires_at IS NULL AND heartbeat_at IS NULL
    AND output_reference IS NULL AND output_sha256 IS NULL
  ) OR (
    status = 'RUNNING' AND attempt_count BETWEEN 1 AND max_attempts
    AND started_at IS NOT NULL AND completed_at IS NULL AND failed_at IS NULL
    AND cancelled_at IS NULL AND leased_by IS NOT NULL AND lease_token_sha256 IS NOT NULL
    AND lease_expires_at IS NOT NULL AND heartbeat_at IS NOT NULL
    AND output_reference IS NULL AND output_sha256 IS NULL
  ) OR (
    status = 'RETRYING' AND attempt_count BETWEEN 1 AND max_attempts - 1
    AND started_at IS NOT NULL AND completed_at IS NULL AND failed_at IS NULL
    AND cancelled_at IS NULL AND safe_error_code IS NOT NULL
    AND leased_by IS NULL AND lease_token_sha256 IS NULL
    AND lease_expires_at IS NULL AND heartbeat_at IS NULL
    AND output_reference IS NULL AND output_sha256 IS NULL
  ) OR (
    status = 'COMPLETED' AND attempt_count BETWEEN 1 AND max_attempts
    AND started_at IS NOT NULL AND completed_at IS NOT NULL AND failed_at IS NULL
    AND cancelled_at IS NULL AND safe_error_code IS NULL
    AND leased_by IS NULL AND lease_token_sha256 IS NULL
    AND lease_expires_at IS NULL AND heartbeat_at IS NULL
  ) OR (
    status = 'FAILED' AND attempt_count BETWEEN 1 AND max_attempts
    AND started_at IS NOT NULL AND completed_at IS NULL AND failed_at IS NOT NULL
    AND cancelled_at IS NULL AND safe_error_code IS NOT NULL
    AND leased_by IS NULL AND lease_token_sha256 IS NULL
    AND lease_expires_at IS NULL AND heartbeat_at IS NULL
    AND output_reference IS NULL AND output_sha256 IS NULL
  ) OR (
    status = 'CANCELLED' AND completed_at IS NULL AND failed_at IS NULL
    AND cancelled_at IS NOT NULL AND leased_by IS NULL AND lease_token_sha256 IS NULL
    AND lease_expires_at IS NULL AND heartbeat_at IS NULL
    AND output_reference IS NULL AND output_sha256 IS NULL
  )
);

CREATE INDEX jobs_expired_lease_idx
  ON hive.jobs (lease_expires_at, id)
  WHERE status = 'RUNNING';

CREATE FUNCTION hive.job_retry_delay_seconds(
  target_retry_policy text,
  target_attempt_count integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF target_retry_policy NOT IN ('NONE', 'FIXED', 'EXPONENTIAL_BACKOFF')
    OR target_attempt_count IS NULL
    OR target_attempt_count NOT BETWEEN 1 AND 25
  THEN
    RAISE EXCEPTION 'WORKER_INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;
  IF target_retry_policy = 'NONE' THEN RETURN 0; END IF;
  IF target_retry_policy = 'FIXED' THEN RETURN 30; END IF;
  RETURN LEAST(3600, (5 * power(2::numeric, target_attempt_count - 1))::integer);
END;
$$;

CREATE FUNCTION hive.claim_next_job(
  target_worker_id text,
  target_lease_seconds integer DEFAULT 300
)
RETURNS TABLE (
  job_id uuid,
  organization_id uuid,
  app_id uuid,
  project_id uuid,
  owner_user_id uuid,
  job_type text,
  input_reference text,
  input_sha256 text,
  attempt_count integer,
  max_attempts integer,
  retry_policy text,
  timeout_class text,
  correlation_id uuid,
  lease_token text,
  lease_expires_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  selected_job_id uuid;
  raw_lease_token text;
BEGIN
  IF target_worker_id IS NULL
    OR target_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    OR target_lease_seconds IS NULL
    OR target_lease_seconds NOT BETWEEN 15 AND 3600
  THEN
    RAISE EXCEPTION 'WORKER_INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;

  SELECT candidate.id INTO selected_job_id
  FROM hive.jobs AS candidate
  WHERE candidate.status IN ('QUEUED', 'RETRYING')
    AND candidate.available_at <= pg_catalog.clock_timestamp()
    AND candidate.attempt_count < candidate.max_attempts
  ORDER BY candidate.priority DESC, candidate.available_at, candidate.id
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF selected_job_id IS NULL THEN RETURN; END IF;

  raw_lease_token := gen_random_uuid()::text;
  RETURN QUERY
  UPDATE hive.jobs AS job
  SET status = 'RUNNING',
      attempt_count = job.attempt_count + 1,
      started_at = COALESCE(job.started_at, pg_catalog.clock_timestamp()),
      safe_error_code = NULL,
      leased_by = target_worker_id,
      lease_token_sha256 = pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(raw_lease_token, 'UTF8')), 'hex'
      ),
      lease_expires_at = pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(secs => target_lease_seconds),
      heartbeat_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  WHERE job.id = selected_job_id
  RETURNING job.id, job.organization_id, job.app_id, job.project_id,
    job.owner_user_id, job.job_type, job.input_reference, job.input_sha256,
    job.attempt_count, job.max_attempts, job.retry_policy, job.timeout_class,
    job.correlation_id, raw_lease_token, job.lease_expires_at;
END;
$$;

CREATE FUNCTION hive.heartbeat_job(
  target_job_id uuid,
  target_worker_id text,
  target_lease_token text,
  target_lease_seconds integer DEFAULT 300
)
RETURNS timestamptz
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE renewed_until timestamptz;
BEGIN
  IF target_job_id IS NULL OR target_worker_id IS NULL OR target_lease_token IS NULL
    OR target_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    OR target_lease_token !~ '^[0-9a-f-]{36}$'
    OR target_lease_seconds IS NULL OR target_lease_seconds NOT BETWEEN 15 AND 3600
  THEN
    RAISE EXCEPTION 'WORKER_INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;

  UPDATE hive.jobs AS job
  SET heartbeat_at = pg_catalog.clock_timestamp(),
      lease_expires_at = pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(secs => target_lease_seconds),
      updated_at = pg_catalog.clock_timestamp()
  WHERE job.id = target_job_id AND job.status = 'RUNNING'
    AND job.leased_by = target_worker_id
    AND job.lease_token_sha256 = pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(target_lease_token, 'UTF8')), 'hex'
    )
    AND job.lease_expires_at > pg_catalog.clock_timestamp()
  RETURNING job.lease_expires_at INTO renewed_until;

  IF renewed_until IS NULL THEN
    RAISE EXCEPTION 'WORKER_LEASE_LOST' USING ERRCODE = 'P0001';
  END IF;
  RETURN renewed_until;
END;
$$;

CREATE FUNCTION hive.complete_job(
  target_job_id uuid,
  target_worker_id text,
  target_lease_token text,
  target_output_sha256 text DEFAULT NULL,
  target_output_reference text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE changed integer;
BEGIN
  IF target_job_id IS NULL OR target_worker_id IS NULL OR target_lease_token IS NULL
    OR target_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    OR target_lease_token !~ '^[0-9a-f-]{36}$'
    OR (target_output_sha256 IS NOT NULL AND target_output_sha256 !~ '^[0-9a-f]{64}$')
    OR (target_output_reference IS NOT NULL AND (
      char_length(target_output_reference) NOT BETWEEN 1 AND 512
      OR target_output_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
    ))
  THEN
    RAISE EXCEPTION 'WORKER_INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;

  UPDATE hive.jobs AS job
  SET status = 'COMPLETED', completed_at = pg_catalog.clock_timestamp(),
      safe_error_code = NULL, output_sha256 = target_output_sha256,
      output_reference = target_output_reference,
      leased_by = NULL, lease_token_sha256 = NULL,
      lease_expires_at = NULL, heartbeat_at = NULL,
      updated_at = pg_catalog.clock_timestamp()
  WHERE job.id = target_job_id AND job.status = 'RUNNING'
    AND job.leased_by = target_worker_id
    AND job.lease_token_sha256 = pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(target_lease_token, 'UTF8')), 'hex'
    )
    AND job.lease_expires_at > pg_catalog.clock_timestamp();
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN
    RAISE EXCEPTION 'WORKER_LEASE_LOST' USING ERRCODE = 'P0001';
  END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION hive.fail_job(
  target_job_id uuid,
  target_worker_id text,
  target_lease_token text,
  target_failure_kind text,
  target_safe_error_code text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE selected_job hive.jobs%ROWTYPE;
DECLARE next_status text;
BEGIN
  IF target_job_id IS NULL OR target_worker_id IS NULL OR target_lease_token IS NULL
    OR target_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    OR target_lease_token !~ '^[0-9a-f-]{36}$'
    OR target_failure_kind NOT IN ('TRANSIENT', 'PERMANENT')
    OR target_safe_error_code IS NULL
    OR target_safe_error_code !~ '^[A-Z][A-Z0-9_]{2,127}$'
  THEN
    RAISE EXCEPTION 'WORKER_INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;

  SELECT job.* INTO selected_job
  FROM hive.jobs AS job
  WHERE job.id = target_job_id AND job.status = 'RUNNING'
    AND job.leased_by = target_worker_id
    AND job.lease_token_sha256 = pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(target_lease_token, 'UTF8')), 'hex'
    )
    AND job.lease_expires_at > pg_catalog.clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WORKER_LEASE_LOST' USING ERRCODE = 'P0001';
  END IF;

  next_status := CASE
    WHEN target_failure_kind = 'TRANSIENT'
      AND selected_job.retry_policy <> 'NONE'
      AND selected_job.attempt_count < selected_job.max_attempts
    THEN 'RETRYING' ELSE 'FAILED' END;

  UPDATE hive.jobs AS job
  SET status = next_status,
      safe_error_code = target_safe_error_code,
      available_at = CASE WHEN next_status = 'RETRYING' THEN
        pg_catalog.clock_timestamp() + pg_catalog.make_interval(
          secs => hive.job_retry_delay_seconds(job.retry_policy, job.attempt_count)
        ) ELSE job.available_at END,
      failed_at = CASE WHEN next_status = 'FAILED'
        THEN pg_catalog.clock_timestamp() ELSE NULL END,
      leased_by = NULL, lease_token_sha256 = NULL,
      lease_expires_at = NULL, heartbeat_at = NULL,
      updated_at = pg_catalog.clock_timestamp()
  WHERE job.id = selected_job.id;
  RETURN next_status;
END;
$$;

CREATE FUNCTION hive.cancel_job(
  target_job_id uuid,
  target_worker_id text,
  target_lease_token text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE changed integer;
BEGIN
  IF target_job_id IS NULL OR target_worker_id IS NULL OR target_lease_token IS NULL
    OR target_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    OR target_lease_token !~ '^[0-9a-f-]{36}$'
  THEN
    RAISE EXCEPTION 'WORKER_INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;
  UPDATE hive.jobs AS job
  SET status = 'CANCELLED', cancelled_at = pg_catalog.clock_timestamp(),
      safe_error_code = NULL, leased_by = NULL, lease_token_sha256 = NULL,
      lease_expires_at = NULL, heartbeat_at = NULL,
      updated_at = pg_catalog.clock_timestamp()
  WHERE job.id = target_job_id AND job.status = 'RUNNING'
    AND job.leased_by = target_worker_id
    AND job.lease_token_sha256 = pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(target_lease_token, 'UTF8')), 'hex'
    )
    AND job.lease_expires_at > pg_catalog.clock_timestamp();
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN
    RAISE EXCEPTION 'WORKER_LEASE_LOST' USING ERRCODE = 'P0001';
  END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION hive.recover_expired_job_leases(target_batch_limit integer DEFAULT 100)
RETURNS TABLE (job_id uuid, status text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF target_batch_limit IS NULL OR target_batch_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'WORKER_INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY
  WITH expired AS (
    SELECT candidate.id
    FROM hive.jobs AS candidate
    WHERE candidate.status = 'RUNNING'
      AND candidate.lease_expires_at <= pg_catalog.clock_timestamp()
    ORDER BY candidate.lease_expires_at, candidate.id
    FOR UPDATE SKIP LOCKED
    LIMIT target_batch_limit
  )
  UPDATE hive.jobs AS job
  SET status = CASE WHEN job.retry_policy <> 'NONE'
      AND job.attempt_count < job.max_attempts THEN 'RETRYING' ELSE 'FAILED' END,
      safe_error_code = 'JOB_LEASE_EXPIRED',
      available_at = CASE WHEN job.retry_policy <> 'NONE'
        AND job.attempt_count < job.max_attempts THEN
        pg_catalog.clock_timestamp() + pg_catalog.make_interval(
          secs => hive.job_retry_delay_seconds(job.retry_policy, job.attempt_count)
        ) ELSE job.available_at END,
      failed_at = CASE WHEN job.retry_policy = 'NONE'
        OR job.attempt_count >= job.max_attempts
        THEN pg_catalog.clock_timestamp() ELSE NULL END,
      leased_by = NULL, lease_token_sha256 = NULL,
      lease_expires_at = NULL, heartbeat_at = NULL,
      updated_at = pg_catalog.clock_timestamp()
  FROM expired
  WHERE job.id = expired.id
  RETURNING job.id, job.status;
END;
$$;

ALTER TABLE audit.events DROP CONSTRAINT audit_events_event_code_check;
ALTER TABLE audit.events ADD CONSTRAINT audit_events_event_code_check CHECK (
  event_code IN (
    'LOGIN_SUCCESS', 'LOGIN_FAILED', 'ORGANIZATION_CREATED',
    'ORGANIZATION_MEMBER_ADDED', 'ORGANIZATION_MEMBER_CHANGED',
    'ORGANIZATION_APP_INSTALLED', 'PROJECT_CREATED', 'PROJECT_ARCHIVED',
    'PROJECT_DELETION_REQUESTED', 'PURCHASE_CREATED', 'PAYMENT_CONFIRMED',
    'PAYMENT_FAILED', 'PAYMENT_REFUNDED', 'ENTITLEMENT_GRANTED',
    'ENTITLEMENT_CHANGED', 'USAGE_BUDGET_CONFIGURED', 'COST_GUARD_DECIDED',
    'JOB_QUEUED', 'JOB_STARTED', 'JOB_RETRY_SCHEDULED', 'JOB_COMPLETED',
    'JOB_FAILED', 'JOB_CANCELLED', 'FILE_EXPORTED', 'ADMIN_ACCESS',
    'FEATURE_FLAG_CHANGED', 'PROVIDER_STATUS_CHANGED', 'WEBHOOK_PROCESSED',
    'AUTHENTICATION', 'AUTHORIZATION', 'BILLING', 'PROJECT', 'JOB', 'PLATFORM'
  )
);

CREATE FUNCTION audit.capture_job_transition()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE transition_event_code text;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  transition_event_code := CASE NEW.status
    WHEN 'RUNNING' THEN 'JOB_STARTED'
    WHEN 'RETRYING' THEN 'JOB_RETRY_SCHEDULED'
    WHEN 'COMPLETED' THEN 'JOB_COMPLETED'
    WHEN 'FAILED' THEN 'JOB_FAILED'
    WHEN 'CANCELLED' THEN 'JOB_CANCELLED'
    ELSE NULL END;
  IF transition_event_code IS NOT NULL THEN
    PERFORM audit.append_core_event(
      transition_event_code, NEW.organization_id, NEW.app_id, NEW.project_id,
      'JOB', NEW.id,
      pg_catalog.jsonb_build_object(
        'job_type', NEW.job_type,
        'status', NEW.status,
        'attempt_count', NEW.attempt_count,
        'max_attempts', NEW.max_attempts,
        'safe_error_code', NEW.safe_error_code
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_jobs_after_transition
AFTER UPDATE OF status ON hive.jobs
FOR EACH ROW EXECUTE FUNCTION audit.capture_job_transition();

REVOKE ALL ON FUNCTION hive.job_retry_delay_seconds(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.claim_next_job(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.heartbeat_job(uuid, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.complete_job(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.fail_job(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.cancel_job(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.recover_expired_job_leases(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit.capture_job_transition() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION hive.job_retry_delay_seconds(text, integer) FROM authenticated;
    REVOKE ALL ON FUNCTION hive.claim_next_job(text, integer) FROM authenticated;
    REVOKE ALL ON FUNCTION hive.heartbeat_job(uuid, text, text, integer) FROM authenticated;
    REVOKE ALL ON FUNCTION hive.complete_job(uuid, text, text, text, text) FROM authenticated;
    REVOKE ALL ON FUNCTION hive.fail_job(uuid, text, text, text, text) FROM authenticated;
    REVOKE ALL ON FUNCTION hive.cancel_job(uuid, text, text) FROM authenticated;
    REVOKE ALL ON FUNCTION hive.recover_expired_job_leases(integer) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA hive TO service_role;
    GRANT EXECUTE ON FUNCTION hive.job_retry_delay_seconds(text, integer) TO service_role;
    GRANT EXECUTE ON FUNCTION hive.claim_next_job(text, integer) TO service_role;
    GRANT EXECUTE ON FUNCTION hive.heartbeat_job(uuid, text, text, integer) TO service_role;
    GRANT EXECUTE ON FUNCTION hive.complete_job(uuid, text, text, text, text) TO service_role;
    GRANT EXECUTE ON FUNCTION hive.fail_job(uuid, text, text, text, text) TO service_role;
    GRANT EXECUTE ON FUNCTION hive.cancel_job(uuid, text, text) TO service_role;
    GRANT EXECUTE ON FUNCTION hive.recover_expired_job_leases(integer) TO service_role;
  END IF;
END;
$$;

COMMENT ON FUNCTION hive.claim_next_job(text, integer) IS
  'Service-role exclusive claim using SKIP LOCKED and a one-time raw lease token.';
COMMENT ON FUNCTION hive.fail_job(uuid, text, text, text, text) IS
  'Service-role transient or permanent failure transition with deterministic retry scheduling.';
COMMENT ON FUNCTION hive.recover_expired_job_leases(integer) IS
  'Service-role bounded recovery of abandoned RUNNING jobs without duplicate ownership.';
