-- green_hive_migration: 0022
-- checkpoint: GH-0505
-- description: Create tenant-safe Search Gateway operation metadata with server-only lifecycle writers.
-- rollback_strategy: FORWARD_FIX_OR_VERIFIED_SEARCH_OPERATION_EXPORT_RESTORE

CREATE TABLE hive.search_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  app_id uuid NOT NULL,
  project_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  operation_id text NOT NULL,
  search_type text NOT NULL,
  capability_code text NOT NULL,
  classification text NOT NULL,
  provider_code text NOT NULL,
  trust_policy_code text NOT NULL,
  trust_decision text NOT NULL,
  sanitization_mode text,
  max_results integer NOT NULL,
  cache_status text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  result_count integer,
  request_count integer,
  estimated_cost numeric(24, 8) NOT NULL,
  actual_cost numeric(24, 8),
  currency text NOT NULL,
  request_fingerprint_sha256 text NOT NULL,
  safe_error_code text,
  started_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT search_operations_project_scope_fk
    FOREIGN KEY (project_id, app_id, organization_id, owner_user_id)
    REFERENCES hive.projects(id, app_id, organization_id, owner_user_id)
    ON DELETE RESTRICT,
  CONSTRAINT search_operations_scope_operation_unique
    UNIQUE (organization_id, app_id, owner_user_id, operation_id),
  CONSTRAINT search_operations_operation_id_check CHECK (
    char_length(operation_id) BETWEEN 8 AND 128
    AND operation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  CONSTRAINT search_operations_search_type_check CHECK (
    char_length(search_type) BETWEEN 3 AND 128
    AND search_type ~ '^[A-Z][A-Z0-9_]*$'
  ),
  CONSTRAINT search_operations_capability_code_check CHECK (
    char_length(capability_code) BETWEEN 3 AND 128
    AND capability_code ~ '^[A-Z][A-Z0-9_]*$'
  ),
  CONSTRAINT search_operations_classification_check CHECK (
    classification IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'HIGHLY_CONFIDENTIAL')
  ),
  CONSTRAINT search_operations_provider_code_check CHECK (
    provider_code ~ '^[A-Z][A-Z0-9_]{2,63}$'
  ),
  CONSTRAINT search_operations_trust_contract_check CHECK (
    trust_policy_code ~ '^[A-Z][A-Z0-9_]{2,127}$'
    AND trust_decision IN ('ALLOW', 'ALLOW_WITH_SANITIZATION')
    AND (
      (trust_decision = 'ALLOW' AND sanitization_mode IS NULL)
      OR (
        trust_decision = 'ALLOW_WITH_SANITIZATION'
        AND sanitization_mode = 'ABSTRACT_QUERY'
      )
    )
  ),
  CONSTRAINT search_operations_max_results_check CHECK (
    max_results BETWEEN 1 AND 50
  ),
  CONSTRAINT search_operations_cache_status_check CHECK (
    cache_status IN ('NOT_APPLICABLE', 'MISS', 'HIT')
  ),
  CONSTRAINT search_operations_status_check CHECK (
    status IN ('PENDING', 'SUCCEEDED', 'FAILED')
  ),
  CONSTRAINT search_operations_terminal_state_check CHECK (
    (
      status = 'PENDING'
      AND result_count IS NULL
      AND request_count IS NULL
      AND actual_cost IS NULL
      AND safe_error_code IS NULL
      AND completed_at IS NULL
    )
    OR (
      status = 'SUCCEEDED'
      AND result_count BETWEEN 0 AND max_results
      AND request_count BETWEEN 1 AND 3
      AND actual_cost > 0
      AND safe_error_code IS NULL
      AND completed_at IS NOT NULL
    )
    OR (
      status = 'FAILED'
      AND result_count IS NULL
      AND request_count IS NULL
      AND actual_cost IS NULL
      AND safe_error_code ~ '^SEARCH_GATEWAY_[A-Z0-9_]{3,96}$'
      AND completed_at IS NOT NULL
    )
  ),
  CONSTRAINT search_operations_estimated_cost_check CHECK (estimated_cost > 0),
  CONSTRAINT search_operations_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT search_operations_fingerprint_check CHECK (
    request_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
  )
);

CREATE INDEX search_operations_project_started_idx
  ON hive.search_operations (
    organization_id, app_id, project_id, started_at DESC, id DESC
  );

CREATE FUNCTION hive.start_search_operation(
  target_project_id uuid,
  target_operation_id text,
  target_search_type text,
  target_capability_code text,
  target_classification text,
  target_provider_code text,
  target_trust_policy_code text,
  target_trust_decision text,
  target_sanitization_mode text,
  target_max_results integer,
  target_cache_status text,
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
  violated_constraint text;
BEGIN
  IF actor_user_id IS NULL
    OR actor_app_id IS NULL
    OR actor_organization_id IS NULL
    OR hive.is_platform_admin()
    OR NOT hive.has_trusted_organization_context()
  THEN
    RAISE EXCEPTION 'SEARCH_GATEWAY_ACCESS_DENIED' USING ERRCODE = 'P0001';
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
    RAISE EXCEPTION 'SEARCH_GATEWAY_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  IF target_operation_id IS NULL
    OR target_operation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
    OR target_search_type IS NULL
    OR target_search_type !~ '^[A-Z][A-Z0-9_]{2,127}$'
    OR pg_catalog.left(
      target_search_type,
      pg_catalog.char_length(hive.current_app_code()) + 1
    ) IS DISTINCT FROM hive.current_app_code() || '_'
    OR target_capability_code IS NULL
    OR target_capability_code !~ '^[A-Z][A-Z0-9_]{2,127}$'
    OR pg_catalog.left(
      target_capability_code,
      pg_catalog.char_length(hive.current_app_code()) + 1
    ) IS DISTINCT FROM hive.current_app_code() || '_'
    OR target_classification IS NULL
    OR target_classification NOT IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'HIGHLY_CONFIDENTIAL')
    OR target_provider_code IS NULL
    OR target_provider_code !~ '^[A-Z][A-Z0-9_]{2,63}$'
    OR target_trust_policy_code IS NULL
    OR target_trust_policy_code !~ '^[A-Z][A-Z0-9_]{2,127}$'
    OR target_trust_decision IS NULL
    OR target_trust_decision NOT IN ('ALLOW', 'ALLOW_WITH_SANITIZATION')
    OR NOT (
      (target_trust_decision = 'ALLOW' AND target_sanitization_mode IS NULL)
      OR (
        target_trust_decision = 'ALLOW_WITH_SANITIZATION'
        AND target_sanitization_mode = 'ABSTRACT_QUERY'
      )
    )
    OR target_max_results IS NULL
    OR target_max_results NOT BETWEEN 1 AND 50
    OR target_cache_status IS DISTINCT FROM 'NOT_APPLICABLE'
    OR target_request_fingerprint_sha256 IS NULL
    OR target_request_fingerprint_sha256 !~ '^[0-9a-f]{64}$'
    OR target_estimated_cost IS NULL
    OR target_estimated_cost <= 0
    OR target_currency IS NULL
    OR target_currency !~ '^[A-Z]{3}$'
  THEN
    RAISE EXCEPTION 'SEARCH_GATEWAY_INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM hive.search_operations AS operation
    WHERE operation.organization_id = actor_organization_id
      AND operation.app_id = actor_app_id
      AND operation.owner_user_id = actor_user_id
      AND operation.operation_id = target_operation_id
  ) THEN
    RAISE EXCEPTION 'SEARCH_GATEWAY_OPERATION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    INSERT INTO hive.search_operations (
      organization_id, app_id, project_id, owner_user_id, operation_id,
      search_type, capability_code, classification, provider_code,
      trust_policy_code, trust_decision, sanitization_mode, max_results,
      cache_status, estimated_cost, currency, request_fingerprint_sha256
    ) VALUES (
      actor_organization_id, actor_app_id, selected_project.id, actor_user_id,
      target_operation_id, target_search_type, target_capability_code,
      target_classification, target_provider_code, target_trust_policy_code,
      target_trust_decision, target_sanitization_mode, target_max_results,
      target_cache_status, target_estimated_cost, target_currency,
      target_request_fingerprint_sha256
    )
    RETURNING id INTO created_id;
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS violated_constraint = CONSTRAINT_NAME;
      IF violated_constraint = 'search_operations_scope_operation_unique' THEN
        RAISE EXCEPTION 'SEARCH_GATEWAY_OPERATION_CONFLICT' USING ERRCODE = 'P0001';
      END IF;
      RAISE;
  END;

  RETURN created_id;
END;
$$;

CREATE FUNCTION hive.complete_search_operation(
  target_operation_id text,
  target_result_count integer,
  target_request_count integer,
  target_actual_cost numeric,
  target_cache_status text
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
  selected_operation hive.search_operations%ROWTYPE;
BEGIN
  IF actor_user_id IS NULL
    OR actor_app_id IS NULL
    OR actor_organization_id IS NULL
    OR hive.is_platform_admin()
    OR NOT hive.has_trusted_organization_context()
  THEN
    RAISE EXCEPTION 'SEARCH_GATEWAY_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  IF target_operation_id IS NULL
    OR target_operation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
    OR target_result_count IS NULL
    OR target_result_count < 0
    OR target_request_count IS NULL
    OR target_request_count NOT BETWEEN 1 AND 3
    OR target_actual_cost IS NULL
    OR target_actual_cost <= 0
    OR target_cache_status IS NULL
    OR target_cache_status NOT IN ('NOT_APPLICABLE', 'MISS', 'HIT')
  THEN
    RAISE EXCEPTION 'SEARCH_GATEWAY_INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;

  SELECT operation.* INTO selected_operation
  FROM hive.search_operations AS operation
  WHERE operation.organization_id = actor_organization_id
    AND operation.app_id = actor_app_id
    AND operation.owner_user_id = actor_user_id
    AND operation.operation_id = target_operation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SEARCH_GATEWAY_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  IF selected_operation.status <> 'PENDING' THEN
    RAISE EXCEPTION 'SEARCH_GATEWAY_OPERATION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  IF target_result_count > selected_operation.max_results
    OR target_cache_status IS DISTINCT FROM selected_operation.cache_status
  THEN
    RAISE EXCEPTION 'SEARCH_GATEWAY_INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;

  UPDATE hive.search_operations
  SET status = 'SUCCEEDED',
      result_count = target_result_count,
      request_count = target_request_count,
      actual_cost = target_actual_cost,
      cache_status = target_cache_status,
      completed_at = statement_timestamp(),
      updated_at = statement_timestamp()
  WHERE id = selected_operation.id;

  RETURN selected_operation.id;
END;
$$;

CREATE FUNCTION hive.complete_search_operation_accounted(
  target_operation_id text,
  target_reservation_id uuid,
  target_result_count integer,
  target_provider_request_count integer,
  target_actual_cost numeric,
  target_cache_status text
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
  selected_operation hive.search_operations%ROWTYPE;
  selected_reservation hive.cost_guard_reservations%ROWTYPE;
  usage_metadata jsonb;
BEGIN
  IF actor_user_id IS NULL
    OR actor_app_id IS NULL
    OR actor_organization_id IS NULL
    OR hive.is_platform_admin()
    OR NOT hive.has_trusted_organization_context()
  THEN
    RAISE EXCEPTION 'SEARCH_GATEWAY_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  IF target_operation_id IS NULL
    OR target_operation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
    OR target_reservation_id IS NULL
    OR target_result_count IS NULL
    OR target_result_count < 0
    OR target_provider_request_count IS NULL
    OR target_provider_request_count NOT BETWEEN 1 AND 3
    OR target_actual_cost IS NULL
    OR target_actual_cost <= 0
    OR target_actual_cost > 9999999999999999.99999999
    OR target_cache_status IS DISTINCT FROM 'NOT_APPLICABLE'
  THEN
    RAISE EXCEPTION 'SEARCH_GATEWAY_INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;

  SELECT operation.* INTO selected_operation
  FROM hive.search_operations AS operation
  WHERE operation.organization_id = actor_organization_id
    AND operation.app_id = actor_app_id
    AND operation.owner_user_id = actor_user_id
    AND operation.operation_id = target_operation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SEARCH_GATEWAY_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  IF selected_operation.status <> 'PENDING' THEN
    RAISE EXCEPTION 'SEARCH_GATEWAY_OPERATION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  IF selected_operation.cache_status <> 'NOT_APPLICABLE'
    OR target_cache_status IS DISTINCT FROM selected_operation.cache_status
    OR target_result_count > selected_operation.max_results
  THEN
    RAISE EXCEPTION 'SEARCH_GATEWAY_INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;

  SELECT reservation.* INTO selected_reservation
  FROM hive.cost_guard_reservations AS reservation
  WHERE reservation.id = target_reservation_id
    AND reservation.organization_id = selected_operation.organization_id
    AND reservation.app_id = selected_operation.app_id
    AND reservation.project_id = selected_operation.project_id
    AND reservation.owner_user_id = selected_operation.owner_user_id
    AND reservation.operation_id = selected_operation.operation_id
    AND reservation.capability_code = selected_operation.capability_code
    AND reservation.currency = selected_operation.currency
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SEARCH_GATEWAY_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  IF selected_reservation.status <> 'RESERVED' THEN
    RAISE EXCEPTION 'SEARCH_GATEWAY_OPERATION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  IF selected_reservation.estimated_amount IS DISTINCT FROM selected_operation.estimated_cost THEN
    RAISE EXCEPTION 'SEARCH_GATEWAY_INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;

  usage_metadata := pg_catalog.jsonb_build_object(
    'search_type', selected_operation.search_type,
    'result_count', target_result_count,
    'provider_request_count', target_provider_request_count
  );

  PERFORM hive.consume_cost_reservation(
    selected_reservation.id,
    target_actual_cost,
    selected_operation.provider_code,
    'SEARCH_GATEWAY',
    NULL,
    statement_timestamp(),
    usage_metadata
  );

  PERFORM hive.record_usage_event(
    selected_operation.project_id,
    NULL,
    selected_operation.operation_id,
    'search-usage-' || selected_reservation.id::text,
    'DEBIT',
    'SEARCH_REQUESTS',
    target_provider_request_count,
    'REQUESTS',
    selected_operation.capability_code,
    NULL,
    selected_operation.provider_code,
    'SEARCH_GATEWAY',
    statement_timestamp(),
    usage_metadata
  );

  RETURN hive.complete_search_operation(
    selected_operation.operation_id,
    target_result_count,
    target_provider_request_count,
    target_actual_cost,
    target_cache_status
  );
END;
$$;

CREATE FUNCTION hive.fail_search_operation(
  target_operation_id text,
  target_safe_error_code text
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
  selected_operation hive.search_operations%ROWTYPE;
BEGIN
  IF actor_user_id IS NULL
    OR actor_app_id IS NULL
    OR actor_organization_id IS NULL
    OR hive.is_platform_admin()
    OR NOT hive.has_trusted_organization_context()
  THEN
    RAISE EXCEPTION 'SEARCH_GATEWAY_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  IF target_operation_id IS NULL
    OR target_operation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
    OR target_safe_error_code IS NULL
    OR target_safe_error_code !~ '^SEARCH_GATEWAY_[A-Z0-9_]{3,96}$'
  THEN
    RAISE EXCEPTION 'SEARCH_GATEWAY_INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;

  SELECT operation.* INTO selected_operation
  FROM hive.search_operations AS operation
  WHERE operation.organization_id = actor_organization_id
    AND operation.app_id = actor_app_id
    AND operation.owner_user_id = actor_user_id
    AND operation.operation_id = target_operation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SEARCH_GATEWAY_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  IF selected_operation.status <> 'PENDING' THEN
    RAISE EXCEPTION 'SEARCH_GATEWAY_OPERATION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM hive.cost_guard_reservations AS reservation
    WHERE reservation.organization_id = selected_operation.organization_id
      AND reservation.app_id = selected_operation.app_id
      AND reservation.project_id = selected_operation.project_id
      AND reservation.owner_user_id = selected_operation.owner_user_id
      AND reservation.operation_id = selected_operation.operation_id
  ) THEN
    RAISE EXCEPTION 'SEARCH_GATEWAY_OPERATION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  UPDATE hive.search_operations
  SET status = 'FAILED',
      safe_error_code = target_safe_error_code,
      completed_at = statement_timestamp(),
      updated_at = statement_timestamp()
  WHERE id = selected_operation.id;

  RETURN selected_operation.id;
END;
$$;

CREATE FUNCTION hive.fail_search_operation_accounted(
  target_operation_id text,
  target_reservation_id uuid,
  target_safe_error_code text
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
  selected_operation hive.search_operations%ROWTYPE;
  selected_reservation hive.cost_guard_reservations%ROWTYPE;
  release_metadata jsonb;
BEGIN
  IF actor_user_id IS NULL
    OR actor_app_id IS NULL
    OR actor_organization_id IS NULL
    OR hive.is_platform_admin()
    OR NOT hive.has_trusted_organization_context()
  THEN
    RAISE EXCEPTION 'SEARCH_GATEWAY_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  IF target_operation_id IS NULL
    OR target_operation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
    OR target_reservation_id IS NULL
    OR target_safe_error_code IS NULL
    OR target_safe_error_code !~ '^SEARCH_GATEWAY_[A-Z0-9_]{3,96}$'
  THEN
    RAISE EXCEPTION 'SEARCH_GATEWAY_INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;

  SELECT operation.* INTO selected_operation
  FROM hive.search_operations AS operation
  WHERE operation.organization_id = actor_organization_id
    AND operation.app_id = actor_app_id
    AND operation.owner_user_id = actor_user_id
    AND operation.operation_id = target_operation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SEARCH_GATEWAY_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  SELECT reservation.* INTO selected_reservation
  FROM hive.cost_guard_reservations AS reservation
  WHERE reservation.id = target_reservation_id
    AND reservation.organization_id = selected_operation.organization_id
    AND reservation.app_id = selected_operation.app_id
    AND reservation.project_id = selected_operation.project_id
    AND reservation.owner_user_id = selected_operation.owner_user_id
    AND reservation.operation_id = selected_operation.operation_id
    AND reservation.capability_code = selected_operation.capability_code
    AND reservation.currency = selected_operation.currency
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SEARCH_GATEWAY_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  IF selected_reservation.estimated_amount IS DISTINCT FROM selected_operation.estimated_cost THEN
    RAISE EXCEPTION 'SEARCH_GATEWAY_INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;

  release_metadata := pg_catalog.jsonb_build_object('reasonCode', target_safe_error_code);

  IF selected_operation.status = 'FAILED'
    AND selected_operation.safe_error_code = target_safe_error_code
    AND selected_reservation.status = 'RELEASED'
    AND selected_reservation.terminal_metadata = release_metadata
  THEN
    RETURN selected_operation.id;
  END IF;

  IF selected_operation.status <> 'PENDING'
    OR selected_reservation.status <> 'RESERVED'
  THEN
    RAISE EXCEPTION 'SEARCH_GATEWAY_OPERATION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  PERFORM hive.release_cost_reservation(selected_reservation.id, release_metadata);

  UPDATE hive.search_operations
  SET status = 'FAILED',
      safe_error_code = target_safe_error_code,
      completed_at = statement_timestamp(),
      updated_at = statement_timestamp()
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
    'AI_OPERATION_FAILED', 'SEARCH_OPERATION_COMPLETED',
    'SEARCH_OPERATION_FAILED', 'FILE_EXPORTED', 'ADMIN_ACCESS',
    'FEATURE_FLAG_CHANGED', 'PROVIDER_STATUS_CHANGED', 'WEBHOOK_PROCESSED',
    'AUTHENTICATION', 'AUTHORIZATION', 'BILLING', 'PROJECT', 'JOB', 'PLATFORM'
  )
);

ALTER TABLE audit.events DROP CONSTRAINT audit_events_subject_type_check;
ALTER TABLE audit.events ADD CONSTRAINT audit_events_subject_type_check CHECK (
  subject_type IN (
    'AUTHENTICATION', 'ORGANIZATION', 'ORGANIZATION_MEMBER',
    'ORGANIZATION_APP', 'PROJECT', 'PURCHASE', 'PAYMENT', 'ENTITLEMENT',
    'USAGE_BUDGET', 'COST_GUARD_DECISION', 'JOB', 'AI_OPERATION',
    'SEARCH_OPERATION', 'PLATFORM'
  )
);

CREATE FUNCTION audit.capture_search_operation_transition()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IN ('SUCCEEDED', 'FAILED')
    AND NEW.status IS DISTINCT FROM OLD.status
  THEN
    PERFORM audit.append_core_event(
      CASE NEW.status
        WHEN 'SUCCEEDED' THEN 'SEARCH_OPERATION_COMPLETED'
        ELSE 'SEARCH_OPERATION_FAILED'
      END,
      NEW.organization_id,
      NEW.app_id,
      NEW.project_id,
      'SEARCH_OPERATION',
      NEW.id,
      pg_catalog.jsonb_build_object(
        'search_type', NEW.search_type,
        'status', NEW.status,
        'provider_code', NEW.provider_code,
        'result_count', NEW.result_count,
        'request_count', NEW.request_count,
        'cache_status', NEW.cache_status,
        'safe_error_code', NEW.safe_error_code
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_search_operations_after_transition
AFTER UPDATE OF status ON hive.search_operations
FOR EACH ROW EXECUTE FUNCTION audit.capture_search_operation_transition();

REVOKE ALL ON hive.search_operations FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.start_search_operation(
  uuid, text, text, text, text, text, text, text, text, integer, text, text, numeric, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.complete_search_operation(
  text, integer, integer, numeric, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.complete_search_operation_accounted(
  text, uuid, integer, integer, numeric, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.fail_search_operation(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.fail_search_operation_accounted(text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit.capture_search_operation_transition() FROM PUBLIC;

ALTER TABLE hive.search_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.search_operations FORCE ROW LEVEL SECURITY;

CREATE POLICY search_operations_owner_or_platform_select
  ON hive.search_operations
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
      search_type, capability_code, classification, provider_code,
      trust_policy_code, trust_decision, sanitization_mode, max_results,
      cache_status, status, result_count, request_count, estimated_cost,
      actual_cost, currency, safe_error_code, started_at, completed_at, updated_at
    ) ON hive.search_operations TO authenticated;

    REVOKE ALL ON FUNCTION hive.start_search_operation(
      uuid, text, text, text, text, text, text, text, text, integer, text, text, numeric, text
    ) FROM authenticated;
    REVOKE ALL ON FUNCTION hive.complete_search_operation(
      text, integer, integer, numeric, text
    ) FROM authenticated;
    REVOKE ALL ON FUNCTION hive.complete_search_operation_accounted(
      text, uuid, integer, integer, numeric, text
    ) FROM authenticated;
    REVOKE ALL ON FUNCTION hive.fail_search_operation(text, text) FROM authenticated;
    REVOKE ALL ON FUNCTION hive.fail_search_operation_accounted(
      text, uuid, text
    ) FROM authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION hive.start_search_operation(
      uuid, text, text, text, text, text, text, text, text, integer, text, text, numeric, text
    ) TO service_role;
    REVOKE ALL ON FUNCTION hive.complete_search_operation(
      text, integer, integer, numeric, text
    ) FROM service_role;
    GRANT EXECUTE ON FUNCTION hive.complete_search_operation_accounted(
      text, uuid, integer, integer, numeric, text
    ) TO service_role;
    GRANT EXECUTE ON FUNCTION hive.fail_search_operation(text, text) TO service_role;
    GRANT EXECUTE ON FUNCTION hive.fail_search_operation_accounted(
      text, uuid, text
    ) TO service_role;
  END IF;
END;
$$;

COMMENT ON TABLE hive.search_operations IS
  'Tenant-safe Search Gateway execution metadata only; raw queries, URLs, snippets and results are prohibited.';
COMMENT ON FUNCTION hive.start_search_operation(
  uuid, text, text, text, text, text, text, text, text, integer, text, text, numeric, text
) IS 'Server-only start for one trusted non-replayable Search Gateway operation identity.';
COMMENT ON FUNCTION hive.complete_search_operation(
  text, integer, integer, numeric, text
) IS 'Private terminal success helper; direct execution is withheld from PUBLIC, authenticated and service_role.';
COMMENT ON FUNCTION hive.complete_search_operation_accounted(
  text, uuid, integer, integer, numeric, text
) IS 'Server-only atomic Search success: consumes the matching reservation, records SEARCH_REQUESTS usage and completes metadata-only operation evidence.';
COMMENT ON FUNCTION hive.fail_search_operation(text, text) IS
  'Server-only terminal failure transition for an operation that has no cost reservation.';
COMMENT ON FUNCTION hive.fail_search_operation_accounted(text, uuid, text) IS
  'Server-only atomic Search failure: releases the matching reservation and records terminal metadata-only operation evidence.';
