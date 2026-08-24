-- green_hive_migration: 0018
-- checkpoint: GH-0402
-- description: Add entitlement-aware atomic cost reservation, consumption and release decisions.
-- rollback_strategy: FORWARD_FIX_OR_VERIFIED_COST_GUARD_LEDGER_EXPORT_RESTORE

CREATE TABLE hive.cost_guard_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  app_id uuid NOT NULL,
  project_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  budget_id uuid NOT NULL,
  reservation_id uuid,
  operation_id text NOT NULL,
  capability_code text NOT NULL,
  decision text NOT NULL,
  reason_code text NOT NULL,
  estimated_amount numeric(24, 8) NOT NULL,
  currency text NOT NULL,
  request_fingerprint_sha256 text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cost_guard_decisions_project_scope_fk
    FOREIGN KEY (project_id, app_id, organization_id, owner_user_id)
    REFERENCES hive.projects(id, app_id, organization_id, owner_user_id)
    ON DELETE RESTRICT,
  CONSTRAINT cost_guard_decisions_budget_scope_fk
    FOREIGN KEY (budget_id, organization_id, app_id, project_id, owner_user_id)
    REFERENCES hive.usage_budgets(id, organization_id, app_id, project_id, owner_user_id)
    ON DELETE RESTRICT,
  CONSTRAINT cost_guard_decisions_id_scope_unique
    UNIQUE (id, organization_id, app_id, project_id, owner_user_id),
  CONSTRAINT cost_guard_decisions_operation_unique
    UNIQUE (organization_id, app_id, project_id, owner_user_id, operation_id),
  CONSTRAINT cost_guard_decisions_operation_check CHECK (
    char_length(operation_id) BETWEEN 1 AND 200
    AND operation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  CONSTRAINT cost_guard_decisions_capability_check CHECK (
    capability_code ~ '^[A-Z][A-Z0-9_]{2,127}$'
  ),
  CONSTRAINT cost_guard_decisions_outcome_check CHECK (
    decision IN (
      'ALLOW', 'ALLOW_CACHED', 'ALLOW_CHEAPER_PROVIDER',
      'ALLOW_REDUCED_CONTEXT', 'ALLOW_REDUCED_SCOPE',
      'DENY_ENTITLEMENT', 'DENY_BUDGET'
    )
  ),
  CONSTRAINT cost_guard_decisions_reason_check CHECK (
    (decision = 'ALLOW' AND reason_code = 'BUDGET_RESERVED')
    OR (decision = 'DENY_ENTITLEMENT' AND reason_code = 'ENTITLEMENT_REQUIRED')
    OR (decision = 'DENY_BUDGET' AND reason_code = 'BUDGET_EXHAUSTED')
  ),
  CONSTRAINT cost_guard_decisions_amount_check CHECK (estimated_amount > 0),
  CONSTRAINT cost_guard_decisions_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT cost_guard_decisions_fingerprint_check CHECK (
    request_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT cost_guard_decisions_metadata_object_check CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT cost_guard_decisions_metadata_size_check CHECK (octet_length(metadata::text) <= 2048),
  CONSTRAINT cost_guard_decisions_metadata_confidential_keys_check CHECK (
    NOT metadata ?| ARRAY[
      'authorization', 'content', 'cookie', 'document', 'password', 'payload',
      'prompt', 'secret', 'signature', 'token'
    ]
  )
);

CREATE INDEX cost_guard_decisions_budget_time_idx
  ON hive.cost_guard_decisions (budget_id, created_at, id);

CREATE TABLE hive.cost_guard_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  app_id uuid NOT NULL,
  project_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  budget_id uuid NOT NULL,
  decision_id uuid NOT NULL UNIQUE,
  operation_id text NOT NULL,
  capability_code text NOT NULL,
  estimated_amount numeric(24, 8) NOT NULL,
  consumed_amount numeric(24, 8) NOT NULL DEFAULT 0,
  currency text NOT NULL,
  status text NOT NULL DEFAULT 'RESERVED',
  cost_event_id uuid,
  request_fingerprint_sha256 text NOT NULL,
  terminal_fingerprint_sha256 text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  terminal_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  released_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cost_guard_reservations_project_scope_fk
    FOREIGN KEY (project_id, app_id, organization_id, owner_user_id)
    REFERENCES hive.projects(id, app_id, organization_id, owner_user_id)
    ON DELETE RESTRICT,
  CONSTRAINT cost_guard_reservations_budget_scope_fk
    FOREIGN KEY (budget_id, organization_id, app_id, project_id, owner_user_id)
    REFERENCES hive.usage_budgets(id, organization_id, app_id, project_id, owner_user_id)
    ON DELETE RESTRICT,
  CONSTRAINT cost_guard_reservations_decision_fk
    FOREIGN KEY (decision_id)
    REFERENCES hive.cost_guard_decisions(id)
    ON DELETE RESTRICT,
  CONSTRAINT cost_guard_reservations_cost_event_fk
    FOREIGN KEY (cost_event_id)
    REFERENCES hive.cost_events(id)
    ON DELETE RESTRICT,
  CONSTRAINT cost_guard_reservations_id_scope_unique
    UNIQUE (id, organization_id, app_id, project_id, owner_user_id),
  CONSTRAINT cost_guard_reservations_operation_unique
    UNIQUE (organization_id, app_id, project_id, owner_user_id, operation_id),
  CONSTRAINT cost_guard_reservations_operation_check CHECK (
    char_length(operation_id) BETWEEN 1 AND 200
    AND operation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  CONSTRAINT cost_guard_reservations_capability_check CHECK (
    capability_code ~ '^[A-Z][A-Z0-9_]{2,127}$'
  ),
  CONSTRAINT cost_guard_reservations_amounts_check CHECK (
    estimated_amount > 0
    AND consumed_amount >= 0
    AND consumed_amount <= estimated_amount
  ),
  CONSTRAINT cost_guard_reservations_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT cost_guard_reservations_status_check CHECK (
    status IN ('RESERVED', 'CONSUMED', 'RELEASED')
  ),
  CONSTRAINT cost_guard_reservations_state_check CHECK (
    (
      status = 'RESERVED'
      AND consumed_amount = 0
      AND cost_event_id IS NULL
      AND terminal_fingerprint_sha256 IS NULL
      AND consumed_at IS NULL
      AND released_at IS NULL
    )
    OR (
      status = 'CONSUMED'
      AND consumed_amount > 0
      AND cost_event_id IS NOT NULL
      AND terminal_fingerprint_sha256 IS NOT NULL
      AND consumed_at IS NOT NULL
      AND released_at IS NULL
    )
    OR (
      status = 'RELEASED'
      AND consumed_amount = 0
      AND cost_event_id IS NULL
      AND terminal_fingerprint_sha256 IS NOT NULL
      AND consumed_at IS NULL
      AND released_at IS NOT NULL
    )
  ),
  CONSTRAINT cost_guard_reservations_fingerprints_check CHECK (
    request_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
    AND (
      terminal_fingerprint_sha256 IS NULL
      OR terminal_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
    )
  ),
  CONSTRAINT cost_guard_reservations_metadata_object_check CHECK (
    jsonb_typeof(metadata) = 'object' AND jsonb_typeof(terminal_metadata) = 'object'
  ),
  CONSTRAINT cost_guard_reservations_metadata_size_check CHECK (
    octet_length(metadata::text) <= 2048
    AND octet_length(terminal_metadata::text) <= 2048
  ),
  CONSTRAINT cost_guard_reservations_metadata_confidential_keys_check CHECK (
    NOT metadata ?| ARRAY[
      'authorization', 'content', 'cookie', 'document', 'password', 'payload',
      'prompt', 'secret', 'signature', 'token'
    ]
    AND NOT terminal_metadata ?| ARRAY[
      'authorization', 'content', 'cookie', 'document', 'password', 'payload',
      'prompt', 'secret', 'signature', 'token'
    ]
  )
);

ALTER TABLE hive.cost_guard_decisions
  ADD CONSTRAINT cost_guard_decisions_reservation_fk
  FOREIGN KEY (reservation_id)
  REFERENCES hive.cost_guard_reservations(id)
  ON DELETE SET NULL;

CREATE INDEX cost_guard_reservations_budget_status_idx
  ON hive.cost_guard_reservations (budget_id, status, reserved_at, id);

CREATE FUNCTION hive.reserve_project_cost(
  target_project_id uuid,
  target_budget_id uuid,
  target_operation_id text,
  target_capability_code text,
  target_estimated_amount numeric,
  target_currency text,
  target_metadata jsonb DEFAULT '{}'::jsonb
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
  selected_budget hive.usage_budgets%ROWTYPE;
  existing_decision hive.cost_guard_decisions%ROWTYPE;
  created_decision_id uuid;
  created_reservation_id uuid;
  fingerprint_hash text;
  selected_decision text;
  selected_reason text;
  safe_metadata jsonb := COALESCE(target_metadata, '{}'::jsonb);
BEGIN
  IF actor_user_id IS NULL
    OR actor_app_id IS NULL
    OR actor_organization_id IS NULL
    OR hive.is_platform_admin()
    OR NOT hive.has_trusted_organization_context()
  THEN
    RAISE EXCEPTION 'COST_GUARD_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  IF target_operation_id IS NULL
    OR char_length(target_operation_id) NOT BETWEEN 1 AND 200
    OR target_operation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    OR target_capability_code IS NULL
    OR target_capability_code !~ '^[A-Z][A-Z0-9_]{2,127}$'
    OR target_capability_code NOT LIKE hive.current_app_code() || '\_%' ESCAPE '\'
    OR target_estimated_amount IS NULL
    OR target_estimated_amount <= 0
    OR target_estimated_amount > 9999999999999999.99999999
    OR target_currency IS NULL
    OR target_currency !~ '^[A-Z]{3}$'
    OR jsonb_typeof(safe_metadata) <> 'object'
    OR octet_length(safe_metadata::text) > 2048
    OR safe_metadata ?| ARRAY[
      'authorization', 'content', 'cookie', 'document', 'password', 'payload',
      'prompt', 'secret', 'signature', 'token'
    ]
  THEN
    RAISE EXCEPTION 'COST_GUARD_INVALID_INPUT' USING ERRCODE = 'P0001';
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
    RAISE EXCEPTION 'COST_GUARD_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  SELECT budget.*
  INTO selected_budget
  FROM hive.usage_budgets AS budget
  WHERE budget.id = target_budget_id
    AND budget.project_id = selected_project.id
    AND budget.owner_user_id = actor_user_id
    AND budget.app_id = actor_app_id
    AND budget.organization_id = actor_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COST_GUARD_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  IF selected_budget.measurement_kind <> 'COST'
    OR selected_budget.unit_code <> target_currency
  THEN
    RAISE EXCEPTION 'COST_GUARD_INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;

  fingerprint_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.concat_ws(
        '|', target_project_id::text, target_budget_id::text, target_operation_id,
        target_capability_code, pg_catalog.trim_scale(target_estimated_amount)::text,
        target_currency, safe_metadata::text
      ),
      'UTF8'
    )),
    'hex'
  );

  SELECT decision.*
  INTO existing_decision
  FROM hive.cost_guard_decisions AS decision
  WHERE decision.organization_id = actor_organization_id
    AND decision.app_id = actor_app_id
    AND decision.project_id = selected_project.id
    AND decision.owner_user_id = actor_user_id
    AND decision.operation_id = target_operation_id
  FOR SHARE;

  IF FOUND THEN
    IF existing_decision.request_fingerprint_sha256 <> fingerprint_hash THEN
      RAISE EXCEPTION 'COST_GUARD_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    RETURN existing_decision.id;
  END IF;

  IF NOT hive.can_project_capability(target_project_id, target_capability_code) THEN
    selected_decision := 'DENY_ENTITLEMENT';
    selected_reason := 'ENTITLEMENT_REQUIRED';
  ELSIF selected_budget.status <> 'ACTIVE'
    OR (
      selected_budget.period_start IS NOT NULL
      AND (
        statement_timestamp() < selected_budget.period_start
        OR statement_timestamp() >= selected_budget.period_end
      )
    )
    OR selected_budget.consumed_amount
      + selected_budget.reserved_amount
      + target_estimated_amount
      > selected_budget.ceiling_amount
  THEN
    selected_decision := 'DENY_BUDGET';
    selected_reason := 'BUDGET_EXHAUSTED';
  ELSE
    selected_decision := 'ALLOW';
    selected_reason := 'BUDGET_RESERVED';
  END IF;

  INSERT INTO hive.cost_guard_decisions (
    organization_id, app_id, project_id, owner_user_id, budget_id,
    operation_id, capability_code, decision, reason_code,
    estimated_amount, currency, request_fingerprint_sha256, metadata
  ) VALUES (
    actor_organization_id, actor_app_id, selected_project.id, actor_user_id, selected_budget.id,
    target_operation_id, target_capability_code, selected_decision, selected_reason,
    target_estimated_amount, target_currency, fingerprint_hash, safe_metadata
  )
  ON CONFLICT (organization_id, app_id, project_id, owner_user_id, operation_id)
  DO NOTHING
  RETURNING id INTO created_decision_id;

  IF created_decision_id IS NULL THEN
    SELECT decision.*
    INTO existing_decision
    FROM hive.cost_guard_decisions AS decision
    WHERE decision.organization_id = actor_organization_id
      AND decision.app_id = actor_app_id
      AND decision.project_id = selected_project.id
      AND decision.owner_user_id = actor_user_id
      AND decision.operation_id = target_operation_id
    FOR SHARE;
    IF existing_decision.request_fingerprint_sha256 <> fingerprint_hash THEN
      RAISE EXCEPTION 'COST_GUARD_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    RETURN existing_decision.id;
  END IF;

  IF selected_decision = 'ALLOW' THEN
    INSERT INTO hive.cost_guard_reservations (
      organization_id, app_id, project_id, owner_user_id, budget_id, decision_id,
      operation_id, capability_code, estimated_amount, currency,
      request_fingerprint_sha256, metadata
    ) VALUES (
      actor_organization_id, actor_app_id, selected_project.id, actor_user_id,
      selected_budget.id, created_decision_id, target_operation_id,
      target_capability_code, target_estimated_amount, target_currency,
      fingerprint_hash, safe_metadata
    )
    RETURNING id INTO created_reservation_id;

    UPDATE hive.usage_budgets
    SET reserved_amount = reserved_amount + target_estimated_amount,
        updated_at = statement_timestamp()
    WHERE id = selected_budget.id;

    UPDATE hive.cost_guard_decisions
    SET reservation_id = created_reservation_id
    WHERE id = created_decision_id;
  END IF;

  RETURN created_decision_id;
END;
$$;

CREATE FUNCTION hive.consume_cost_reservation(
  target_reservation_id uuid,
  target_actual_amount numeric,
  target_provider_code text,
  target_service_code text,
  target_model_code text,
  target_occurred_at timestamptz,
  target_metadata jsonb DEFAULT '{}'::jsonb
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
  selected_reservation hive.cost_guard_reservations%ROWTYPE;
  selected_budget hive.usage_budgets%ROWTYPE;
  created_cost_event_id uuid;
  terminal_fingerprint_hash text;
  safe_metadata jsonb := COALESCE(target_metadata, '{}'::jsonb);
BEGIN
  IF actor_user_id IS NULL
    OR actor_app_id IS NULL
    OR actor_organization_id IS NULL
    OR hive.is_platform_admin()
    OR NOT hive.has_trusted_organization_context()
  THEN
    RAISE EXCEPTION 'COST_GUARD_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  IF target_actual_amount IS NULL
    OR target_actual_amount <= 0
    OR target_actual_amount > 9999999999999999.99999999
    OR target_provider_code IS NULL
    OR target_provider_code !~ '^[A-Z][A-Z0-9_]{1,63}$'
    OR target_service_code IS NULL
    OR target_service_code !~ '^[A-Z][A-Z0-9_]{1,63}$'
    OR (target_model_code IS NOT NULL AND (
      char_length(target_model_code) NOT BETWEEN 1 AND 128
      OR target_model_code !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    ))
    OR jsonb_typeof(safe_metadata) <> 'object'
    OR octet_length(safe_metadata::text) > 2048
    OR safe_metadata ?| ARRAY[
      'authorization', 'content', 'cookie', 'document', 'password', 'payload',
      'prompt', 'secret', 'signature', 'token'
    ]
  THEN
    RAISE EXCEPTION 'COST_GUARD_INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;

  SELECT reservation.*
  INTO selected_reservation
  FROM hive.cost_guard_reservations AS reservation
  WHERE reservation.id = target_reservation_id
    AND reservation.owner_user_id = actor_user_id
    AND reservation.app_id = actor_app_id
    AND reservation.organization_id = actor_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COST_GUARD_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  terminal_fingerprint_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.concat_ws(
        '|', 'CONSUME', target_reservation_id::text,
        pg_catalog.trim_scale(target_actual_amount)::text,
        target_provider_code, target_service_code, COALESCE(target_model_code, ''),
        COALESCE(target_occurred_at::text, ''), safe_metadata::text
      ),
      'UTF8'
    )),
    'hex'
  );

  IF selected_reservation.status = 'CONSUMED' THEN
    IF selected_reservation.terminal_fingerprint_sha256 <> terminal_fingerprint_hash THEN
      RAISE EXCEPTION 'COST_GUARD_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    RETURN selected_reservation.id;
  END IF;

  IF selected_reservation.status <> 'RESERVED'
    OR target_actual_amount > selected_reservation.estimated_amount
  THEN
    RAISE EXCEPTION 'COST_GUARD_INVALID_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  SELECT budget.*
  INTO selected_budget
  FROM hive.usage_budgets AS budget
  WHERE budget.id = selected_reservation.budget_id
    AND budget.project_id = selected_reservation.project_id
    AND budget.owner_user_id = actor_user_id
    AND budget.app_id = actor_app_id
    AND budget.organization_id = actor_organization_id
  FOR UPDATE;

  IF NOT FOUND OR selected_budget.reserved_amount < selected_reservation.estimated_amount THEN
    RAISE EXCEPTION 'COST_GUARD_INVALID_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  UPDATE hive.usage_budgets
  SET reserved_amount = reserved_amount - selected_reservation.estimated_amount,
      consumed_amount = consumed_amount + target_actual_amount,
      updated_at = statement_timestamp()
  WHERE id = selected_budget.id;

  created_cost_event_id := hive.record_cost_event(
    selected_reservation.project_id,
    selected_reservation.budget_id,
    selected_reservation.operation_id,
    'cost-guard-consume-' || selected_reservation.id::text,
    'DEBIT',
    target_actual_amount,
    selected_reservation.currency,
    target_provider_code,
    target_service_code,
    target_model_code,
    selected_budget.cycle_id,
    target_occurred_at,
    safe_metadata
  );

  UPDATE hive.cost_guard_reservations
  SET status = 'CONSUMED',
      consumed_amount = target_actual_amount,
      cost_event_id = created_cost_event_id,
      terminal_fingerprint_sha256 = terminal_fingerprint_hash,
      terminal_metadata = safe_metadata,
      consumed_at = statement_timestamp(),
      updated_at = statement_timestamp()
  WHERE id = selected_reservation.id;

  RETURN selected_reservation.id;
END;
$$;

CREATE FUNCTION hive.release_cost_reservation(
  target_reservation_id uuid,
  target_metadata jsonb DEFAULT '{}'::jsonb
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
  selected_reservation hive.cost_guard_reservations%ROWTYPE;
  selected_budget hive.usage_budgets%ROWTYPE;
  terminal_fingerprint_hash text;
  safe_metadata jsonb := COALESCE(target_metadata, '{}'::jsonb);
BEGIN
  IF actor_user_id IS NULL
    OR actor_app_id IS NULL
    OR actor_organization_id IS NULL
    OR hive.is_platform_admin()
    OR NOT hive.has_trusted_organization_context()
  THEN
    RAISE EXCEPTION 'COST_GUARD_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  IF jsonb_typeof(safe_metadata) <> 'object'
    OR octet_length(safe_metadata::text) > 2048
    OR safe_metadata ?| ARRAY[
      'authorization', 'content', 'cookie', 'document', 'password', 'payload',
      'prompt', 'secret', 'signature', 'token'
    ]
  THEN
    RAISE EXCEPTION 'COST_GUARD_INVALID_INPUT' USING ERRCODE = 'P0001';
  END IF;

  SELECT reservation.*
  INTO selected_reservation
  FROM hive.cost_guard_reservations AS reservation
  WHERE reservation.id = target_reservation_id
    AND reservation.owner_user_id = actor_user_id
    AND reservation.app_id = actor_app_id
    AND reservation.organization_id = actor_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COST_GUARD_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  terminal_fingerprint_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.concat_ws('|', 'RELEASE', target_reservation_id::text, safe_metadata::text),
      'UTF8'
    )),
    'hex'
  );

  IF selected_reservation.status = 'RELEASED' THEN
    IF selected_reservation.terminal_fingerprint_sha256 <> terminal_fingerprint_hash THEN
      RAISE EXCEPTION 'COST_GUARD_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    RETURN selected_reservation.id;
  END IF;

  IF selected_reservation.status <> 'RESERVED' THEN
    RAISE EXCEPTION 'COST_GUARD_INVALID_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  SELECT budget.*
  INTO selected_budget
  FROM hive.usage_budgets AS budget
  WHERE budget.id = selected_reservation.budget_id
    AND budget.project_id = selected_reservation.project_id
    AND budget.owner_user_id = actor_user_id
    AND budget.app_id = actor_app_id
    AND budget.organization_id = actor_organization_id
  FOR UPDATE;

  IF NOT FOUND OR selected_budget.reserved_amount < selected_reservation.estimated_amount THEN
    RAISE EXCEPTION 'COST_GUARD_INVALID_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  UPDATE hive.usage_budgets
  SET reserved_amount = reserved_amount - selected_reservation.estimated_amount,
      updated_at = statement_timestamp()
  WHERE id = selected_budget.id;

  UPDATE hive.cost_guard_reservations
  SET status = 'RELEASED',
      terminal_fingerprint_sha256 = terminal_fingerprint_hash,
      terminal_metadata = safe_metadata,
      released_at = statement_timestamp(),
      updated_at = statement_timestamp()
  WHERE id = selected_reservation.id;

  RETURN selected_reservation.id;
END;
$$;

ALTER TABLE audit.events
  DROP CONSTRAINT audit_events_event_code_check;

ALTER TABLE audit.events
  ADD CONSTRAINT audit_events_event_code_check CHECK (
    event_code IN (
      'LOGIN_SUCCESS', 'LOGIN_FAILED', 'ORGANIZATION_CREATED',
      'ORGANIZATION_MEMBER_ADDED', 'ORGANIZATION_MEMBER_CHANGED',
      'ORGANIZATION_APP_INSTALLED', 'PROJECT_CREATED', 'PROJECT_ARCHIVED',
      'PROJECT_DELETION_REQUESTED', 'PURCHASE_CREATED', 'PAYMENT_CONFIRMED',
      'PAYMENT_FAILED', 'PAYMENT_REFUNDED', 'ENTITLEMENT_GRANTED',
      'ENTITLEMENT_CHANGED', 'USAGE_BUDGET_CONFIGURED', 'COST_GUARD_DECIDED',
      'JOB_FAILED', 'FILE_EXPORTED', 'ADMIN_ACCESS', 'FEATURE_FLAG_CHANGED',
      'PROVIDER_STATUS_CHANGED'
    )
  );

ALTER TABLE audit.events
  DROP CONSTRAINT audit_events_subject_type_check;

ALTER TABLE audit.events
  ADD CONSTRAINT audit_events_subject_type_check CHECK (
    subject_type IN (
      'AUTHENTICATION', 'ORGANIZATION', 'ORGANIZATION_MEMBER',
      'ORGANIZATION_APP', 'PROJECT', 'PURCHASE', 'PAYMENT', 'ENTITLEMENT',
      'USAGE_BUDGET', 'COST_GUARD_DECISION', 'PLATFORM'
    )
  );

CREATE FUNCTION audit.capture_cost_guard_decision()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM audit.append_core_event(
    'COST_GUARD_DECIDED',
    NEW.organization_id,
    NEW.app_id,
    NEW.project_id,
    'COST_GUARD_DECISION',
    NEW.id,
    jsonb_build_object(
      'decision', NEW.decision,
      'reason_code', NEW.reason_code,
      'capability_code', NEW.capability_code,
      'currency', NEW.currency
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_cost_guard_decisions_after_insert
AFTER INSERT ON hive.cost_guard_decisions
FOR EACH ROW EXECUTE FUNCTION audit.capture_cost_guard_decision();

REVOKE ALL ON hive.cost_guard_decisions FROM PUBLIC;
REVOKE ALL ON hive.cost_guard_reservations FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.reserve_project_cost(
  uuid, uuid, text, text, numeric, text, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.consume_cost_reservation(
  uuid, numeric, text, text, text, timestamptz, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.release_cost_reservation(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit.capture_cost_guard_decision() FROM PUBLIC;

ALTER TABLE hive.cost_guard_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.cost_guard_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.cost_guard_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.cost_guard_reservations FORCE ROW LEVEL SECURITY;

CREATE POLICY cost_guard_decisions_owner_or_platform_select
  ON hive.cost_guard_decisions
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

CREATE POLICY cost_guard_reservations_owner_or_platform_select
  ON hive.cost_guard_reservations
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
      id, organization_id, app_id, project_id, owner_user_id, budget_id,
      reservation_id, operation_id, capability_code, decision, reason_code,
      estimated_amount, currency, metadata, created_at
    ) ON hive.cost_guard_decisions TO authenticated;
    GRANT SELECT (
      id, organization_id, app_id, project_id, owner_user_id, budget_id,
      decision_id, operation_id, capability_code, estimated_amount, currency,
      status, reserved_at, consumed_at, released_at, updated_at
    ) ON hive.cost_guard_reservations TO authenticated;
    REVOKE ALL ON FUNCTION hive.reserve_project_cost(
      uuid, uuid, text, text, numeric, text, jsonb
    ) FROM authenticated;
    REVOKE ALL ON FUNCTION hive.consume_cost_reservation(
      uuid, numeric, text, text, text, timestamptz, jsonb
    ) FROM authenticated;
    REVOKE ALL ON FUNCTION hive.release_cost_reservation(uuid, jsonb) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION hive.reserve_project_cost(
      uuid, uuid, text, text, numeric, text, jsonb
    ) TO service_role;
    GRANT EXECUTE ON FUNCTION hive.consume_cost_reservation(
      uuid, numeric, text, text, text, timestamptz, jsonb
    ) TO service_role;
    GRANT EXECUTE ON FUNCTION hive.release_cost_reservation(uuid, jsonb) TO service_role;
  END IF;
END;
$$;

COMMENT ON TABLE hive.cost_guard_decisions IS
  'Append-only entitlement and budget decisions keyed idempotently by trusted operation identity.';
COMMENT ON TABLE hive.cost_guard_reservations IS
  'Atomic exact-decimal cost reservations with one bounded consume or release transition.';
COMMENT ON FUNCTION hive.reserve_project_cost(
  uuid, uuid, text, text, numeric, text, jsonb
) IS 'Internal entitlement-aware atomic cost reservation and allow/deny decision boundary.';
COMMENT ON FUNCTION hive.consume_cost_reservation(
  uuid, numeric, text, text, text, timestamptz, jsonb
) IS 'Internal atomic reservation consumption with same-transaction monetary cost evidence.';
COMMENT ON FUNCTION hive.release_cost_reservation(uuid, jsonb) IS
  'Internal atomic release of an unconsumed cost reservation.';
COMMENT ON TABLE hive.usage_budgets IS
  'Project-scoped exact-decimal ceilings with GH-0402 atomic cost reservation and consumption.';
