-- green_hive_migration: 0021
-- checkpoint: GH-0503
-- description: Create tenant-safe AI Gateway operation metadata with server-only lifecycle writers.
-- rollback_strategy: FORWARD_FIX_OR_VERIFIED_AI_OPERATION_EXPORT_RESTORE

CREATE TABLE hive.ai_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  app_id uuid NOT NULL,
  project_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  operation_id text NOT NULL,
  task_type text NOT NULL,
  output_mode text NOT NULL,
  output_schema_id text,
  classification text NOT NULL,
  provider_code text NOT NULL,
  model_code text NOT NULL,
  trust_policy_code text NOT NULL,
  trust_decision text NOT NULL,
  sanitization_mode text,
  status text NOT NULL DEFAULT 'PENDING',
  finish_reason text,
  input_tokens integer,
  output_tokens integer,
  estimated_cost numeric(24, 8) NOT NULL,
  actual_cost numeric(24, 8),
  currency text NOT NULL,
  request_fingerprint_sha256 text NOT NULL,
  safe_error_code text,
  started_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT ai_operations_project_scope_fk
    FOREIGN KEY (project_id, app_id, organization_id, owner_user_id)
    REFERENCES hive.projects(id, app_id, organization_id, owner_user_id)
    ON DELETE RESTRICT,
  CONSTRAINT ai_operations_scope_operation_unique
    UNIQUE (organization_id, app_id, project_id, owner_user_id, operation_id),
  CONSTRAINT ai_operations_operation_id_check CHECK (
    char_length(operation_id) BETWEEN 8 AND 128
    AND operation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  CONSTRAINT ai_operations_task_type_check CHECK (
    char_length(task_type) BETWEEN 3 AND 128
    AND task_type ~ '^[A-Z][A-Z0-9_]*$'
  ),
  CONSTRAINT ai_operations_output_contract_check CHECK (
    (output_mode = 'TEXT' AND output_schema_id IS NULL)
    OR (
      output_mode = 'STRUCTURED'
      AND output_schema_id ~ '^[A-Z][A-Z0-9_]{2,127}$'
    )
  ),
  CONSTRAINT ai_operations_classification_check CHECK (
    classification IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'HIGHLY_CONFIDENTIAL')
  ),
  CONSTRAINT ai_operations_provider_code_check CHECK (
    provider_code ~ '^[A-Z][A-Z0-9_]{2,63}$'
  ),
  CONSTRAINT ai_operations_model_code_check CHECK (
    char_length(model_code) BETWEEN 3 AND 128
    AND model_code ~ '^[A-Z][A-Z0-9_.:-]*$'
  ),
  CONSTRAINT ai_operations_trust_contract_check CHECK (
    trust_policy_code ~ '^[A-Z][A-Z0-9_]{2,127}$'
    AND trust_decision IN ('ALLOW', 'ALLOW_WITH_SANITIZATION')
    AND (
      (trust_decision = 'ALLOW' AND sanitization_mode IS NULL)
      OR (
        trust_decision = 'ALLOW_WITH_SANITIZATION'
        AND sanitization_mode IN ('MINIMIZE_CONTEXT', 'ABSTRACT_QUERY', 'METADATA_ONLY')
      )
    )
  ),
  CONSTRAINT ai_operations_status_check CHECK (
    status IN ('PENDING', 'SUCCEEDED', 'FAILED')
  ),
  CONSTRAINT ai_operations_terminal_state_check CHECK (
    (
      status = 'PENDING'
      AND finish_reason IS NULL
      AND input_tokens IS NULL
      AND output_tokens IS NULL
      AND actual_cost IS NULL
      AND safe_error_code IS NULL
      AND completed_at IS NULL
    )
    OR (
      status = 'SUCCEEDED'
      AND finish_reason IN ('STOP', 'LENGTH')
      AND input_tokens >= 0
      AND output_tokens >= 0
      AND actual_cost > 0
      AND safe_error_code IS NULL
      AND completed_at IS NOT NULL
    )
    OR (
      status = 'FAILED'
      AND finish_reason IS NULL
      AND input_tokens IS NULL
      AND output_tokens IS NULL
      AND actual_cost IS NULL
      AND safe_error_code ~ '^AI_GATEWAY_[A-Z0-9_]{3,96}$'
      AND completed_at IS NOT NULL
    )
  ),
  CONSTRAINT ai_operations_estimated_cost_check CHECK (estimated_cost > 0),
  CONSTRAINT ai_operations_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT ai_operations_fingerprint_check CHECK (
    request_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
  )
);

CREATE INDEX ai_operations_project_started_idx
  ON hive.ai_operations (organization_id, app_id, project_id, started_at DESC, id DESC);

CREATE FUNCTION hive.start_ai_operation(
  target_project_id uuid,
  target_operation_id text,
  target_task_type text,
  target_output_mode text,
  target_output_schema_id text,
  target_classification text,
  target_provider_code text,
  target_model_code text,
  target_trust_policy_code text,
  target_trust_decision text,
  target_sanitization_mode text,
  target_request_fingerprint_sha256 text,
  target_estimated_cost numeric,
  target_currency text
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
  created_id uuid;
BEGIN
  IF actor_user_id IS NULL
    OR actor_app_id IS NULL
    OR actor_organization_id IS NULL
    OR hive.is_platform_admin()
    OR NOT hive.has_trusted_organization_context()
  THEN
    RAISE EXCEPTION 'AI_GATEWAY_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  SELECT project.* INTO selected_project
  FROM hive.projects AS project
  WHERE project.id = target_project_id
    AND project.organization_id = actor_organization_id
    AND project.app_id = actor_app_id
    AND project.owner_user_id = actor_user_id
    AND project.status NOT IN ('DELETED')
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AI_GATEWAY_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  IF target_operation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
    OR target_task_type !~ '^[A-Z][A-Z0-9_]{2,127}$'
    OR target_task_type NOT LIKE hive.current_app_code() || '\_%' ESCAPE '\'
    OR target_output_mode NOT IN ('TEXT', 'STRUCTURED')
    OR NOT (
      (target_output_mode = 'TEXT' AND target_output_schema_id IS NULL)
      OR (
        target_output_mode = 'STRUCTURED'
        AND target_output_schema_id ~ '^[A-Z][A-Z0-9_]{2,127}$'
      )
    )
    OR target_classification NOT IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'HIGHLY_CONFIDENTIAL')
    OR target_provider_code !~ '^[A-Z][A-Z0-9_]{2,63}$'
    OR target_model_code !~ '^[A-Z][A-Z0-9_.:-]{2,127}$'
    OR target_trust_policy_code !~ '^[A-Z][A-Z0-9_]{2,127}$'
    OR target_trust_decision NOT IN ('ALLOW', 'ALLOW_WITH_SANITIZATION')
    OR NOT (
      (target_trust_decision = 'ALLOW' AND target_sanitization_mode IS NULL)
      OR (
        target_trust_decision = 'ALLOW_WITH_SANITIZATION'
        AND target_sanitization_mode IN ('MINIMIZE_CONTEXT', 'ABSTRACT_QUERY', 'METADATA_ONLY')
      )
    )
    OR target_request_fingerprint_sha256 !~ '^[0-9a-f]{64}$'
    OR target_estimated_cost <= 0
    OR target_currency !~ '^[A-Z]{3}$'
  THEN
    RAISE EXCEPTION 'AI_GATEWAY_INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM hive.ai_operations AS operation
    WHERE operation.organization_id = actor_organization_id
      AND operation.app_id = actor_app_id
      AND operation.project_id = selected_project.id
      AND operation.owner_user_id = actor_user_id
      AND operation.operation_id = target_operation_id
  ) THEN
    RAISE EXCEPTION 'AI_GATEWAY_OPERATION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO hive.ai_operations (
    organization_id, app_id, project_id, owner_user_id, operation_id,
    task_type, output_mode, output_schema_id, classification, provider_code,
    model_code, trust_policy_code, trust_decision, sanitization_mode,
    estimated_cost, currency, request_fingerprint_sha256
  ) VALUES (
    actor_organization_id, actor_app_id, selected_project.id, actor_user_id,
    target_operation_id, target_task_type, target_output_mode, target_output_schema_id,
    target_classification, target_provider_code, target_model_code,
    target_trust_policy_code, target_trust_decision, target_sanitization_mode,
    target_estimated_cost, target_currency, target_request_fingerprint_sha256
  ) RETURNING id INTO created_id;
  RETURN created_id;
END;
$$;

CREATE FUNCTION hive.complete_ai_operation(
  target_operation_id text,
  target_finish_reason text,
  target_input_tokens integer,
  target_output_tokens integer,
  target_actual_cost numeric
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
  selected_operation hive.ai_operations%ROWTYPE;
BEGIN
  IF actor_user_id IS NULL OR actor_app_id IS NULL OR actor_organization_id IS NULL
    OR hive.is_platform_admin() OR NOT hive.has_trusted_organization_context()
  THEN
    RAISE EXCEPTION 'AI_GATEWAY_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;
  IF target_finish_reason NOT IN ('STOP', 'LENGTH')
    OR target_input_tokens < 0 OR target_output_tokens < 0 OR target_actual_cost <= 0
  THEN
    RAISE EXCEPTION 'AI_GATEWAY_INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;
  SELECT operation.* INTO selected_operation
  FROM hive.ai_operations AS operation
  WHERE operation.organization_id = actor_organization_id
    AND operation.app_id = actor_app_id
    AND operation.owner_user_id = actor_user_id
    AND operation.operation_id = target_operation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AI_GATEWAY_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;
  IF selected_operation.status <> 'PENDING' THEN
    RAISE EXCEPTION 'AI_GATEWAY_OPERATION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;
  UPDATE hive.ai_operations SET
    status = 'SUCCEEDED', finish_reason = target_finish_reason,
    input_tokens = target_input_tokens, output_tokens = target_output_tokens,
    actual_cost = target_actual_cost, completed_at = statement_timestamp(),
    updated_at = statement_timestamp()
  WHERE id = selected_operation.id;
  RETURN selected_operation.id;
END;
$$;

CREATE FUNCTION hive.fail_ai_operation(target_operation_id text, target_safe_error_code text)
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
  selected_operation hive.ai_operations%ROWTYPE;
BEGIN
  IF actor_user_id IS NULL OR actor_app_id IS NULL OR actor_organization_id IS NULL
    OR hive.is_platform_admin() OR NOT hive.has_trusted_organization_context()
  THEN
    RAISE EXCEPTION 'AI_GATEWAY_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;
  IF target_safe_error_code !~ '^AI_GATEWAY_[A-Z0-9_]{3,96}$' THEN
    RAISE EXCEPTION 'AI_GATEWAY_INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;
  SELECT operation.* INTO selected_operation
  FROM hive.ai_operations AS operation
  WHERE operation.organization_id = actor_organization_id
    AND operation.app_id = actor_app_id
    AND operation.owner_user_id = actor_user_id
    AND operation.operation_id = target_operation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AI_GATEWAY_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;
  IF selected_operation.status <> 'PENDING' THEN
    RAISE EXCEPTION 'AI_GATEWAY_OPERATION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;
  UPDATE hive.ai_operations SET
    status = 'FAILED', safe_error_code = target_safe_error_code,
    completed_at = statement_timestamp(), updated_at = statement_timestamp()
  WHERE id = selected_operation.id;
  RETURN selected_operation.id;
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
    'JOB_FAILED', 'JOB_CANCELLED', 'AI_OPERATION_COMPLETED',
    'AI_OPERATION_FAILED', 'FILE_EXPORTED', 'ADMIN_ACCESS',
    'FEATURE_FLAG_CHANGED', 'PROVIDER_STATUS_CHANGED', 'WEBHOOK_PROCESSED',
    'AUTHENTICATION', 'AUTHORIZATION', 'BILLING', 'PROJECT', 'JOB', 'PLATFORM'
  )
);

ALTER TABLE audit.events DROP CONSTRAINT audit_events_subject_type_check;
ALTER TABLE audit.events ADD CONSTRAINT audit_events_subject_type_check CHECK (
  subject_type IN (
    'AUTHENTICATION', 'ORGANIZATION', 'ORGANIZATION_MEMBER',
    'ORGANIZATION_APP', 'PROJECT', 'PURCHASE', 'PAYMENT', 'ENTITLEMENT',
    'USAGE_BUDGET', 'COST_GUARD_DECISION', 'JOB', 'AI_OPERATION', 'PLATFORM'
  )
);

CREATE FUNCTION audit.capture_ai_operation_transition()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IN ('SUCCEEDED', 'FAILED') AND NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM audit.append_core_event(
      CASE NEW.status WHEN 'SUCCEEDED' THEN 'AI_OPERATION_COMPLETED' ELSE 'AI_OPERATION_FAILED' END,
      NEW.organization_id, NEW.app_id, NEW.project_id, 'AI_OPERATION', NEW.id,
      pg_catalog.jsonb_build_object(
        'task_type', NEW.task_type,
        'status', NEW.status,
        'provider_code', NEW.provider_code,
        'model_code', NEW.model_code,
        'finish_reason', NEW.finish_reason,
        'safe_error_code', NEW.safe_error_code
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_ai_operations_after_transition
AFTER UPDATE OF status ON hive.ai_operations
FOR EACH ROW EXECUTE FUNCTION audit.capture_ai_operation_transition();

REVOKE ALL ON hive.ai_operations FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.start_ai_operation(
  uuid, text, text, text, text, text, text, text, text, text, text, text, numeric, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.complete_ai_operation(text, text, integer, integer, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.fail_ai_operation(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit.capture_ai_operation_transition() FROM PUBLIC;

ALTER TABLE hive.ai_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.ai_operations FORCE ROW LEVEL SECURITY;

CREATE POLICY ai_operations_owner_or_platform_select
  ON hive.ai_operations
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
      id, organization_id, app_id, project_id, owner_user_id, operation_id,
      task_type, output_mode, output_schema_id, classification, provider_code,
      model_code, trust_policy_code, trust_decision, sanitization_mode, status,
      finish_reason, input_tokens, output_tokens, estimated_cost, actual_cost,
      currency, safe_error_code, started_at, completed_at, updated_at
    ) ON hive.ai_operations TO authenticated;
    REVOKE ALL ON FUNCTION hive.start_ai_operation(
      uuid, text, text, text, text, text, text, text, text, text, text, text, numeric, text
    ) FROM authenticated;
    REVOKE ALL ON FUNCTION hive.complete_ai_operation(text, text, integer, integer, numeric)
      FROM authenticated;
    REVOKE ALL ON FUNCTION hive.fail_ai_operation(text, text) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION hive.start_ai_operation(
      uuid, text, text, text, text, text, text, text, text, text, text, text, numeric, text
    ) TO service_role;
    GRANT EXECUTE ON FUNCTION hive.complete_ai_operation(text, text, integer, integer, numeric)
      TO service_role;
    GRANT EXECUTE ON FUNCTION hive.fail_ai_operation(text, text) TO service_role;
  END IF;
END;
$$;

COMMENT ON TABLE hive.ai_operations IS
  'Tenant-safe AI Gateway execution metadata only; raw prompts, inputs and outputs are prohibited.';
COMMENT ON FUNCTION hive.start_ai_operation(
  uuid, text, text, text, text, text, text, text, text, text, text, text, numeric, text
) IS 'Server-only start for one trusted non-replayable AI operation identity.';
COMMENT ON FUNCTION hive.complete_ai_operation(text, text, integer, integer, numeric) IS
  'Server-only terminal success transition after provider usage and structured schema validation.';
COMMENT ON FUNCTION hive.fail_ai_operation(text, text) IS
  'Server-only terminal failure transition containing only a stable safe error code.';
