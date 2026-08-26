-- green_hive_migration: 0019
-- checkpoint: GH-0403
-- description: Create registered app job types and the tenant-safe idempotent database queue foundation.
-- rollback_strategy: FORWARD_FIX_OR_VERIFIED_JOB_QUEUE_EXPORT_RESTORE
-- Raw payloads remain outside the queue; only opaque references and hashes are persisted.
-- Worker claim and lifecycle transitions remain GH-0404.

CREATE TABLE hive.job_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES hive.apps(id) ON DELETE RESTRICT,
  job_type text NOT NULL,
  handler_owner text NOT NULL,
  required_capability text,
  cost_budget_type text,
  exclusive_scope text,
  idempotency_strategy text NOT NULL,
  retry_policy text NOT NULL,
  max_attempts integer NOT NULL,
  timeout_class text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_registrations_app_job_unique UNIQUE (app_id, job_type),
  CONSTRAINT job_registrations_scope_unique UNIQUE (id, app_id, job_type),
  CONSTRAINT job_registrations_job_type_check CHECK (
    job_type ~ '^[A-Z][A-Z0-9_]{2,127}$'
  ),
  CONSTRAINT job_registrations_handler_owner_check CHECK (
    handler_owner ~ '^[A-Z][A-Z0-9_]{2,63}$'
  ),
  CONSTRAINT job_registrations_capability_check CHECK (
    required_capability IS NULL
    OR required_capability ~ '^[A-Z][A-Z0-9_]{2,127}$'
  ),
  CONSTRAINT job_registrations_budget_type_check CHECK (
    cost_budget_type IS NULL
    OR cost_budget_type IN ('AI', 'SEARCH', 'DOCUMENT', 'FILE_PROCESSING', 'TOTAL_COST')
  ),
  CONSTRAINT job_registrations_exclusive_scope_check CHECK (
    exclusive_scope IS NULL
    OR exclusive_scope IN ('PROJECT', 'OWNER', 'ORGANIZATION')
  ),
  CONSTRAINT job_registrations_idempotency_check CHECK (
    idempotency_strategy IN ('PROJECT_OWNER_KEY')
  ),
  CONSTRAINT job_registrations_retry_policy_check CHECK (
    retry_policy IN ('NONE', 'FIXED', 'EXPONENTIAL_BACKOFF')
  ),
  CONSTRAINT job_registrations_max_attempts_check CHECK (max_attempts BETWEEN 1 AND 25),
  CONSTRAINT job_registrations_timeout_class_check CHECK (
    timeout_class IN ('SHORT', 'MEDIUM', 'LONG')
  )
);

CREATE TABLE hive.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  app_id uuid NOT NULL,
  project_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  job_registration_id uuid NOT NULL,
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED',
  priority integer NOT NULL DEFAULT 50,
  input_reference text,
  input_sha256 text NOT NULL,
  idempotency_key_sha256 text NOT NULL,
  request_fingerprint_sha256 text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL,
  retry_policy text NOT NULL,
  timeout_class text NOT NULL,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  safe_error_code text,
  queued_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jobs_project_scope_fk
    FOREIGN KEY (project_id, app_id, organization_id, owner_user_id)
    REFERENCES hive.projects(id, app_id, organization_id, owner_user_id)
    ON DELETE RESTRICT,
  CONSTRAINT jobs_registration_scope_fk
    FOREIGN KEY (job_registration_id, app_id, job_type)
    REFERENCES hive.job_registrations(id, app_id, job_type)
    ON DELETE RESTRICT,
  CONSTRAINT jobs_id_scope_unique
    UNIQUE (id, organization_id, app_id, project_id, owner_user_id),
  CONSTRAINT jobs_idempotency_unique
    UNIQUE (organization_id, app_id, project_id, owner_user_id, idempotency_key_sha256),
  CONSTRAINT jobs_job_type_check CHECK (job_type ~ '^[A-Z][A-Z0-9_]{2,127}$'),
  CONSTRAINT jobs_status_check CHECK (
    status IN ('QUEUED', 'RUNNING', 'RETRYING', 'COMPLETED', 'FAILED', 'CANCELLED')
  ),
  CONSTRAINT jobs_priority_check CHECK (priority BETWEEN 0 AND 100),
  CONSTRAINT jobs_input_reference_check CHECK (
    input_reference IS NULL
    OR (
      char_length(input_reference) BETWEEN 1 AND 512
      AND input_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
    )
  ),
  CONSTRAINT jobs_hashes_check CHECK (
    input_sha256 ~ '^[0-9a-f]{64}$'
    AND idempotency_key_sha256 ~ '^[0-9a-f]{64}$'
    AND request_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT jobs_attempts_check CHECK (
    max_attempts BETWEEN 1 AND 25
    AND attempt_count BETWEEN 0 AND max_attempts
  ),
  CONSTRAINT jobs_retry_policy_check CHECK (
    retry_policy IN ('NONE', 'FIXED', 'EXPONENTIAL_BACKOFF')
  ),
  CONSTRAINT jobs_timeout_class_check CHECK (timeout_class IN ('SHORT', 'MEDIUM', 'LONG')),
  CONSTRAINT jobs_safe_error_code_check CHECK (
    safe_error_code IS NULL
    OR safe_error_code ~ '^[A-Z][A-Z0-9_]{2,127}$'
  ),
  CONSTRAINT jobs_lifecycle_check CHECK (
    (
      status = 'QUEUED' AND attempt_count = 0 AND safe_error_code IS NULL
      AND started_at IS NULL AND completed_at IS NULL AND failed_at IS NULL
      AND cancelled_at IS NULL
    ) OR (
      status = 'RUNNING' AND attempt_count BETWEEN 1 AND max_attempts
      AND started_at IS NOT NULL AND completed_at IS NULL AND failed_at IS NULL
      AND cancelled_at IS NULL
    ) OR (
      status = 'RETRYING' AND attempt_count BETWEEN 1 AND max_attempts - 1
      AND started_at IS NOT NULL AND completed_at IS NULL AND failed_at IS NULL
      AND cancelled_at IS NULL
    ) OR (
      status = 'COMPLETED' AND attempt_count BETWEEN 1 AND max_attempts
      AND started_at IS NOT NULL AND completed_at IS NOT NULL AND failed_at IS NULL
      AND cancelled_at IS NULL
    ) OR (
      status = 'FAILED' AND attempt_count BETWEEN 1 AND max_attempts
      AND started_at IS NOT NULL AND completed_at IS NULL AND failed_at IS NOT NULL
      AND cancelled_at IS NULL AND safe_error_code IS NOT NULL
    ) OR (
      status = 'CANCELLED' AND completed_at IS NULL AND failed_at IS NULL
      AND cancelled_at IS NOT NULL
    )
  )
);

CREATE INDEX jobs_owner_project_status_priority_idx
  ON hive.jobs (
    organization_id, app_id, owner_user_id, project_id,
    status, priority DESC, available_at, id
  );

CREATE INDEX jobs_worker_queue_idx
  ON hive.jobs (status, priority DESC, available_at, id)
  WHERE status IN ('QUEUED', 'RETRYING');

CREATE FUNCTION hive.enqueue_project_job(
  target_project_id uuid,
  target_job_type text,
  target_idempotency_key text,
  target_input_sha256 text,
  target_input_reference text DEFAULT NULL,
  target_priority integer DEFAULT 50
)
RETURNS uuid
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
  selected_registration hive.job_registrations%ROWTYPE;
  existing_job hive.jobs%ROWTYPE;
  created_job_id uuid;
  idempotency_hash text;
  fingerprint_hash text;
BEGIN
  IF actor_user_id IS NULL
    OR actor_app_id IS NULL
    OR actor_organization_id IS NULL
    OR hive.is_platform_admin()
    OR NOT hive.has_trusted_organization_context()
  THEN
    RAISE EXCEPTION 'JOB_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  IF target_job_type IS NULL
    OR target_job_type !~ '^[A-Z][A-Z0-9_]{2,127}$'
    OR target_job_type NOT LIKE hive.current_app_code() || '\_%' ESCAPE '\'
    OR target_idempotency_key IS NULL
    OR target_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
    OR target_input_sha256 IS NULL
    OR target_input_sha256 !~ '^[0-9a-f]{64}$'
    OR (target_input_reference IS NOT NULL AND (
      char_length(target_input_reference) NOT BETWEEN 1 AND 512
      OR target_input_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
    ))
    OR target_priority IS NULL
    OR target_priority NOT BETWEEN 0 AND 100
  THEN
    RAISE EXCEPTION 'JOB_INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;

  SELECT project.*
  INTO selected_project
  FROM hive.projects AS project
  WHERE project.id = target_project_id
    AND project.owner_user_id = actor_user_id
    AND project.app_id = actor_app_id
    AND project.organization_id = actor_organization_id
    AND project.status IN ('DRAFT', 'ACTIVE')
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  SELECT app.*
  INTO selected_app
  FROM hive.apps AS app
  WHERE app.id = actor_app_id
    AND app.status <> 'DISABLED';

  IF NOT FOUND OR NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(selected_app.manifest -> 'jobTypes') AS declared(job_type)
    WHERE declared.job_type = target_job_type
  ) THEN
    RAISE EXCEPTION 'JOB_NOT_REGISTERED' USING ERRCODE = 'P0001';
  END IF;

  SELECT registration.*
  INTO selected_registration
  FROM hive.job_registrations AS registration
  WHERE registration.app_id = actor_app_id
    AND registration.job_type = target_job_type
    AND registration.active
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_REGISTERED' USING ERRCODE = 'P0001';
  END IF;

  IF selected_registration.required_capability IS NOT NULL
    AND NOT hive.can_project_capability(
      selected_project.id,
      selected_registration.required_capability
    )
  THEN
    RAISE EXCEPTION 'JOB_ENTITLEMENT_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  idempotency_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(target_idempotency_key, 'UTF8')),
    'hex'
  );
  fingerprint_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.concat_ws(
        '|', target_project_id::text, target_job_type, target_input_sha256,
        COALESCE(target_input_reference, ''), target_priority::text
      ),
      'UTF8'
    )),
    'hex'
  );

  SELECT job.*
  INTO existing_job
  FROM hive.jobs AS job
  WHERE job.organization_id = actor_organization_id
    AND job.app_id = actor_app_id
    AND job.project_id = selected_project.id
    AND job.owner_user_id = actor_user_id
    AND job.idempotency_key_sha256 = idempotency_hash
  FOR SHARE;

  IF FOUND THEN
    IF existing_job.request_fingerprint_sha256 <> fingerprint_hash THEN
      RAISE EXCEPTION 'JOB_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    RETURN existing_job.id;
  END IF;

  INSERT INTO hive.jobs (
    organization_id, app_id, project_id, owner_user_id,
    job_registration_id, job_type, priority, input_reference, input_sha256,
    idempotency_key_sha256, request_fingerprint_sha256,
    max_attempts, retry_policy, timeout_class
  ) VALUES (
    actor_organization_id, actor_app_id, selected_project.id, actor_user_id,
    selected_registration.id, selected_registration.job_type, target_priority,
    target_input_reference, target_input_sha256, idempotency_hash, fingerprint_hash,
    selected_registration.max_attempts, selected_registration.retry_policy,
    selected_registration.timeout_class
  )
  ON CONFLICT (
    organization_id, app_id, project_id, owner_user_id, idempotency_key_sha256
  ) DO NOTHING
  RETURNING id INTO created_job_id;

  IF created_job_id IS NULL THEN
    SELECT job.*
    INTO existing_job
    FROM hive.jobs AS job
    WHERE job.organization_id = actor_organization_id
      AND job.app_id = actor_app_id
      AND job.project_id = selected_project.id
      AND job.owner_user_id = actor_user_id
      AND job.idempotency_key_sha256 = idempotency_hash
    FOR SHARE;
    IF existing_job.request_fingerprint_sha256 <> fingerprint_hash THEN
      RAISE EXCEPTION 'JOB_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    RETURN existing_job.id;
  END IF;

  RETURN created_job_id;
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
    'JOB_QUEUED', 'JOB_FAILED', 'FILE_EXPORTED', 'ADMIN_ACCESS',
    'FEATURE_FLAG_CHANGED', 'PROVIDER_STATUS_CHANGED'
  )
);

ALTER TABLE audit.events DROP CONSTRAINT audit_events_subject_type_check;
ALTER TABLE audit.events ADD CONSTRAINT audit_events_subject_type_check CHECK (
  subject_type IN (
    'AUTHENTICATION', 'ORGANIZATION', 'ORGANIZATION_MEMBER',
    'ORGANIZATION_APP', 'PROJECT', 'PURCHASE', 'PAYMENT', 'ENTITLEMENT',
    'USAGE_BUDGET', 'COST_GUARD_DECISION', 'JOB', 'PLATFORM'
  )
);

CREATE FUNCTION audit.capture_job_queued()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM audit.append_core_event(
    'JOB_QUEUED', NEW.organization_id, NEW.app_id, NEW.project_id,
    'JOB', NEW.id,
    jsonb_build_object(
      'job_type', NEW.job_type,
      'status', NEW.status,
      'priority', NEW.priority,
      'max_attempts', NEW.max_attempts,
      'timeout_class', NEW.timeout_class
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_jobs_after_insert
AFTER INSERT ON hive.jobs
FOR EACH ROW EXECUTE FUNCTION audit.capture_job_queued();

REVOKE ALL ON hive.job_registrations FROM PUBLIC;
REVOKE ALL ON hive.jobs FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.enqueue_project_job(uuid, text, text, text, text, integer)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION audit.capture_job_queued() FROM PUBLIC;

ALTER TABLE hive.job_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.job_registrations FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.jobs FORCE ROW LEVEL SECURITY;

CREATE POLICY job_registrations_current_app_or_platform_select
  ON hive.job_registrations
  FOR SELECT
  TO authenticated
  USING (hive.is_platform_admin() OR app_id = hive.current_app_id());

CREATE POLICY jobs_owner_or_platform_select
  ON hive.jobs
  FOR SELECT
  TO authenticated
  USING (
    hive.is_platform_admin()
    OR (
      auth.uid() IS NOT NULL
      AND organization_id = hive.current_organization_id()
      AND app_id = hive.current_app_id()
      AND owner_user_id = auth.uid()
      AND hive.has_trusted_organization_context()
      AND hive.can_access_project(project_id, app_id, organization_id)
    )
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT (
      id, app_id, job_type, handler_owner, required_capability,
      cost_budget_type, exclusive_scope, idempotency_strategy,
      retry_policy, max_attempts, timeout_class, active
    ) ON hive.job_registrations TO authenticated;
    GRANT SELECT (
      id, organization_id, app_id, project_id, owner_user_id, job_type,
      status, priority, attempt_count, max_attempts, retry_policy, timeout_class,
      correlation_id, safe_error_code, queued_at, available_at, started_at,
      completed_at, failed_at, cancelled_at, created_at, updated_at
    ) ON hive.jobs TO authenticated;
    REVOKE ALL ON FUNCTION hive.enqueue_project_job(uuid, text, text, text, text, integer)
      FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION hive.enqueue_project_job(uuid, text, text, text, text, integer)
      TO service_role;
  END IF;
END;
$$;

COMMENT ON TABLE hive.job_registrations IS
  'App-scoped registered job contracts; handler execution remains outside the queue foundation.';
COMMENT ON TABLE hive.jobs IS
  'Tenant-safe database queue storing opaque references and hashes rather than raw domain payloads.';
COMMENT ON FUNCTION hive.enqueue_project_job(uuid, text, text, text, text, integer) IS
  'Server-only idempotent enqueue after trusted tenant, manifest, registration and entitlement checks.';
