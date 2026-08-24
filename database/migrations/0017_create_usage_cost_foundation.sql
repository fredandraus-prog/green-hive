-- green_hive_migration: 0017
-- checkpoint: GH-0401
-- description: Create project-scoped usage budgets and separate append-only usage and monetary cost ledgers.
-- rollback_strategy: FORWARD_FIX_OR_VERIFIED_USAGE_COST_LEDGER_EXPORT_RESTORE

CREATE TABLE hive.usage_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  app_id uuid NOT NULL,
  project_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  budget_type text NOT NULL,
  measurement_kind text NOT NULL,
  unit_code text NOT NULL,
  ceiling_amount numeric(24, 8) NOT NULL,
  consumed_amount numeric(24, 8) NOT NULL DEFAULT 0,
  reserved_amount numeric(24, 8) NOT NULL DEFAULT 0,
  cycle_id text,
  period_start timestamptz,
  period_end timestamptz,
  status text NOT NULL DEFAULT 'ACTIVE',
  idempotency_key_sha256 text NOT NULL,
  configuration_fingerprint_sha256 text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usage_budgets_project_scope_fk
    FOREIGN KEY (project_id, app_id, organization_id, owner_user_id)
    REFERENCES hive.projects(id, app_id, organization_id, owner_user_id)
    ON DELETE RESTRICT,
  CONSTRAINT usage_budgets_id_scope_unique
    UNIQUE (id, organization_id, app_id, project_id, owner_user_id),
  CONSTRAINT usage_budgets_idempotency_unique
    UNIQUE (organization_id, app_id, project_id, owner_user_id, idempotency_key_sha256),
  CONSTRAINT usage_budgets_type_check CHECK (
    budget_type IN (
      'AI',
      'SEARCH',
      'DOCUMENT',
      'FILE_PROCESSING',
      'TOTAL_COST',
      'SAFETY_RESERVE'
    )
  ),
  CONSTRAINT usage_budgets_measurement_check CHECK (
    measurement_kind IN ('USAGE', 'COST')
  ),
  CONSTRAINT usage_budgets_unit_code_check CHECK (
    unit_code ~ '^[A-Z][A-Z0-9_]{1,31}$'
  ),
  CONSTRAINT usage_budgets_currency_check CHECK (
    measurement_kind <> 'COST' OR unit_code ~ '^[A-Z]{3}$'
  ),
  CONSTRAINT usage_budgets_amounts_check CHECK (
    ceiling_amount > 0
    AND consumed_amount >= 0
    AND reserved_amount >= 0
    AND consumed_amount + reserved_amount <= ceiling_amount
  ),
  CONSTRAINT usage_budgets_cycle_id_check CHECK (
    cycle_id IS NULL OR (
      char_length(cycle_id) BETWEEN 1 AND 128
      AND cycle_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  ),
  CONSTRAINT usage_budgets_period_check CHECK (
    (period_start IS NULL AND period_end IS NULL)
    OR (period_start IS NOT NULL AND period_end IS NOT NULL AND period_end > period_start)
  ),
  CONSTRAINT usage_budgets_status_check CHECK (status IN ('ACTIVE', 'CLOSED')),
  CONSTRAINT usage_budgets_hashes_check CHECK (
    idempotency_key_sha256 ~ '^[0-9a-f]{64}$'
    AND configuration_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT usage_budgets_metadata_object_check CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT usage_budgets_metadata_size_check CHECK (octet_length(metadata::text) <= 2048),
  CONSTRAINT usage_budgets_metadata_confidential_keys_check CHECK (
    NOT metadata ?| ARRAY[
      'authorization', 'content', 'cookie', 'document', 'password', 'payload',
      'prompt', 'secret', 'signature', 'token'
    ]
  )
);

CREATE UNIQUE INDEX usage_budgets_scope_dimension_unique
  ON hive.usage_budgets (
    organization_id,
    app_id,
    project_id,
    owner_user_id,
    budget_type,
    measurement_kind,
    unit_code,
    COALESCE(cycle_id, '')
  );

CREATE INDEX usage_budgets_project_status_idx
  ON hive.usage_budgets (
    organization_id,
    app_id,
    owner_user_id,
    project_id,
    status,
    budget_type
  );

CREATE TABLE hive.usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  app_id uuid NOT NULL,
  project_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  budget_id uuid,
  operation_id text NOT NULL,
  idempotency_key_sha256 text NOT NULL,
  event_fingerprint_sha256 text NOT NULL,
  event_kind text NOT NULL,
  usage_code text NOT NULL,
  quantity numeric(24, 8) NOT NULL,
  unit_code text NOT NULL,
  capability_code text,
  cycle_id text,
  provider_code text,
  service_code text,
  occurred_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usage_events_project_scope_fk
    FOREIGN KEY (project_id, app_id, organization_id, owner_user_id)
    REFERENCES hive.projects(id, app_id, organization_id, owner_user_id)
    ON DELETE RESTRICT,
  CONSTRAINT usage_events_budget_scope_fk
    FOREIGN KEY (budget_id, organization_id, app_id, project_id, owner_user_id)
    REFERENCES hive.usage_budgets(id, organization_id, app_id, project_id, owner_user_id)
    ON DELETE RESTRICT,
  CONSTRAINT usage_events_idempotency_unique
    UNIQUE (organization_id, app_id, project_id, owner_user_id, idempotency_key_sha256),
  CONSTRAINT usage_events_operation_id_check CHECK (
    char_length(operation_id) BETWEEN 1 AND 200
    AND operation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  CONSTRAINT usage_events_hashes_check CHECK (
    idempotency_key_sha256 ~ '^[0-9a-f]{64}$'
    AND event_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT usage_events_kind_check CHECK (event_kind IN ('DEBIT', 'CREDIT')),
  CONSTRAINT usage_events_usage_code_check CHECK (
    usage_code ~ '^[A-Z][A-Z0-9_]{2,127}$'
  ),
  CONSTRAINT usage_events_quantity_check CHECK (quantity > 0),
  CONSTRAINT usage_events_unit_code_check CHECK (
    unit_code ~ '^[A-Z][A-Z0-9_]{1,31}$'
  ),
  CONSTRAINT usage_events_capability_code_check CHECK (
    capability_code IS NULL OR capability_code ~ '^[A-Z][A-Z0-9_]{2,127}$'
  ),
  CONSTRAINT usage_events_cycle_id_check CHECK (
    cycle_id IS NULL OR (
      char_length(cycle_id) BETWEEN 1 AND 128
      AND cycle_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  ),
  CONSTRAINT usage_events_provider_code_check CHECK (
    provider_code IS NULL OR provider_code ~ '^[A-Z][A-Z0-9_]{1,63}$'
  ),
  CONSTRAINT usage_events_service_code_check CHECK (
    service_code IS NULL OR service_code ~ '^[A-Z][A-Z0-9_]{1,63}$'
  ),
  CONSTRAINT usage_events_metadata_object_check CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT usage_events_metadata_size_check CHECK (octet_length(metadata::text) <= 2048),
  CONSTRAINT usage_events_metadata_confidential_keys_check CHECK (
    NOT metadata ?| ARRAY[
      'authorization', 'content', 'cookie', 'document', 'password', 'payload',
      'prompt', 'secret', 'signature', 'token'
    ]
  )
);

CREATE INDEX usage_events_project_time_idx
  ON hive.usage_events (organization_id, app_id, owner_user_id, project_id, occurred_at, id);
CREATE INDEX usage_events_operation_idx
  ON hive.usage_events (project_id, operation_id, occurred_at);
CREATE INDEX usage_events_budget_time_idx
  ON hive.usage_events (budget_id, occurred_at)
  WHERE budget_id IS NOT NULL;

CREATE TABLE hive.cost_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  app_id uuid NOT NULL,
  project_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  budget_id uuid,
  operation_id text NOT NULL,
  idempotency_key_sha256 text NOT NULL,
  event_fingerprint_sha256 text NOT NULL,
  event_kind text NOT NULL,
  amount numeric(24, 8) NOT NULL,
  currency text NOT NULL,
  provider_code text NOT NULL,
  service_code text NOT NULL,
  model_code text,
  cycle_id text,
  occurred_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cost_events_project_scope_fk
    FOREIGN KEY (project_id, app_id, organization_id, owner_user_id)
    REFERENCES hive.projects(id, app_id, organization_id, owner_user_id)
    ON DELETE RESTRICT,
  CONSTRAINT cost_events_budget_scope_fk
    FOREIGN KEY (budget_id, organization_id, app_id, project_id, owner_user_id)
    REFERENCES hive.usage_budgets(id, organization_id, app_id, project_id, owner_user_id)
    ON DELETE RESTRICT,
  CONSTRAINT cost_events_idempotency_unique
    UNIQUE (organization_id, app_id, project_id, owner_user_id, idempotency_key_sha256),
  CONSTRAINT cost_events_operation_id_check CHECK (
    char_length(operation_id) BETWEEN 1 AND 200
    AND operation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  CONSTRAINT cost_events_hashes_check CHECK (
    idempotency_key_sha256 ~ '^[0-9a-f]{64}$'
    AND event_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT cost_events_kind_check CHECK (event_kind IN ('DEBIT', 'CREDIT')),
  CONSTRAINT cost_events_amount_check CHECK (amount > 0),
  CONSTRAINT cost_events_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT cost_events_provider_code_check CHECK (
    provider_code ~ '^[A-Z][A-Z0-9_]{1,63}$'
  ),
  CONSTRAINT cost_events_service_code_check CHECK (
    service_code ~ '^[A-Z][A-Z0-9_]{1,63}$'
  ),
  CONSTRAINT cost_events_model_code_check CHECK (
    model_code IS NULL OR (
      char_length(model_code) BETWEEN 1 AND 128
      AND model_code ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  ),
  CONSTRAINT cost_events_cycle_id_check CHECK (
    cycle_id IS NULL OR (
      char_length(cycle_id) BETWEEN 1 AND 128
      AND cycle_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  ),
  CONSTRAINT cost_events_metadata_object_check CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT cost_events_metadata_size_check CHECK (octet_length(metadata::text) <= 2048),
  CONSTRAINT cost_events_metadata_confidential_keys_check CHECK (
    NOT metadata ?| ARRAY[
      'authorization', 'content', 'cookie', 'document', 'password', 'payload',
      'prompt', 'secret', 'signature', 'token'
    ]
  )
);

CREATE INDEX cost_events_project_time_idx
  ON hive.cost_events (organization_id, app_id, owner_user_id, project_id, occurred_at, id);
CREATE INDEX cost_events_provider_time_idx
  ON hive.cost_events (provider_code, service_code, occurred_at);
CREATE INDEX cost_events_budget_time_idx
  ON hive.cost_events (budget_id, occurred_at)
  WHERE budget_id IS NOT NULL;

CREATE FUNCTION hive.configure_usage_budget(
  target_project_id uuid,
  target_budget_type text,
  target_measurement_kind text,
  target_unit_code text,
  target_ceiling_amount numeric,
  target_cycle_id text,
  target_period_start timestamptz,
  target_period_end timestamptz,
  target_idempotency_key text,
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
  existing_budget hive.usage_budgets%ROWTYPE;
  created_budget_id uuid;
  idempotency_hash text;
  fingerprint_hash text;
  safe_metadata jsonb := COALESCE(target_metadata, '{}'::jsonb);
BEGIN
  IF actor_user_id IS NULL
    OR actor_app_id IS NULL
    OR actor_organization_id IS NULL
    OR hive.is_platform_admin()
    OR NOT hive.has_trusted_organization_context()
  THEN
    RAISE EXCEPTION 'USAGE_COST_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  IF target_budget_type NOT IN (
      'AI', 'SEARCH', 'DOCUMENT', 'FILE_PROCESSING', 'TOTAL_COST', 'SAFETY_RESERVE'
    )
    OR target_measurement_kind NOT IN ('USAGE', 'COST')
    OR target_unit_code IS NULL
    OR target_unit_code !~ '^[A-Z][A-Z0-9_]{1,31}$'
    OR (target_measurement_kind = 'COST' AND target_unit_code !~ '^[A-Z]{3}$')
    OR target_ceiling_amount IS NULL
    OR target_ceiling_amount <= 0
    OR target_ceiling_amount > 9999999999999999.99999999
    OR (target_cycle_id IS NOT NULL AND (
      char_length(target_cycle_id) NOT BETWEEN 1 AND 128
      OR target_cycle_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    ))
    OR ((target_period_start IS NULL) <> (target_period_end IS NULL))
    OR (target_period_start IS NOT NULL AND target_period_end <= target_period_start)
    OR target_idempotency_key IS NULL
    OR char_length(target_idempotency_key) NOT BETWEEN 8 AND 128
    OR target_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    OR jsonb_typeof(safe_metadata) <> 'object'
    OR octet_length(safe_metadata::text) > 2048
    OR safe_metadata ?| ARRAY[
      'authorization', 'content', 'cookie', 'document', 'password', 'payload',
      'prompt', 'secret', 'signature', 'token'
    ]
  THEN
    RAISE EXCEPTION 'USAGE_COST_INVALID_INPUT' USING ERRCODE = 'P0001';
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
    RAISE EXCEPTION 'USAGE_COST_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  idempotency_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(target_idempotency_key, 'UTF8')),
    'hex'
  );
  fingerprint_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.concat_ws(
        '|',
        target_project_id::text,
        target_budget_type,
        target_measurement_kind,
        target_unit_code,
        pg_catalog.trim_scale(target_ceiling_amount)::text,
        COALESCE(target_cycle_id, ''),
        COALESCE(target_period_start::text, ''),
        COALESCE(target_period_end::text, ''),
        safe_metadata::text
      ),
      'UTF8'
    )),
    'hex'
  );

  SELECT budget.*
  INTO existing_budget
  FROM hive.usage_budgets AS budget
  WHERE budget.organization_id = actor_organization_id
    AND budget.app_id = actor_app_id
    AND budget.project_id = selected_project.id
    AND budget.owner_user_id = actor_user_id
    AND budget.idempotency_key_sha256 = idempotency_hash
  FOR SHARE;

  IF FOUND THEN
    IF existing_budget.configuration_fingerprint_sha256 <> fingerprint_hash THEN
      RAISE EXCEPTION 'USAGE_COST_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    RETURN existing_budget.id;
  END IF;

  SELECT budget.*
  INTO existing_budget
  FROM hive.usage_budgets AS budget
  WHERE budget.organization_id = actor_organization_id
    AND budget.app_id = actor_app_id
    AND budget.project_id = selected_project.id
    AND budget.owner_user_id = actor_user_id
    AND budget.budget_type = target_budget_type
    AND budget.measurement_kind = target_measurement_kind
    AND budget.unit_code = target_unit_code
    AND budget.cycle_id IS NOT DISTINCT FROM target_cycle_id
  FOR SHARE;

  IF FOUND THEN
    IF existing_budget.configuration_fingerprint_sha256 <> fingerprint_hash THEN
      RAISE EXCEPTION 'USAGE_COST_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    RETURN existing_budget.id;
  END IF;

  INSERT INTO hive.usage_budgets (
    organization_id,
    app_id,
    project_id,
    owner_user_id,
    budget_type,
    measurement_kind,
    unit_code,
    ceiling_amount,
    cycle_id,
    period_start,
    period_end,
    idempotency_key_sha256,
    configuration_fingerprint_sha256,
    metadata
  )
  VALUES (
    actor_organization_id,
    actor_app_id,
    selected_project.id,
    actor_user_id,
    target_budget_type,
    target_measurement_kind,
    target_unit_code,
    target_ceiling_amount,
    target_cycle_id,
    target_period_start,
    target_period_end,
    idempotency_hash,
    fingerprint_hash,
    safe_metadata
  )
  RETURNING id INTO created_budget_id;

  RETURN created_budget_id;
END;
$$;

CREATE FUNCTION hive.record_usage_event(
  target_project_id uuid,
  target_budget_id uuid,
  target_operation_id text,
  target_idempotency_key text,
  target_event_kind text,
  target_usage_code text,
  target_quantity numeric,
  target_unit_code text,
  target_capability_code text,
  target_cycle_id text,
  target_provider_code text,
  target_service_code text,
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
  selected_project hive.projects%ROWTYPE;
  selected_budget hive.usage_budgets%ROWTYPE;
  existing_event hive.usage_events%ROWTYPE;
  created_event_id uuid;
  idempotency_hash text;
  fingerprint_hash text;
  safe_occurred_at timestamptz := COALESCE(target_occurred_at, statement_timestamp());
  safe_metadata jsonb := COALESCE(target_metadata, '{}'::jsonb);
BEGIN
  IF actor_user_id IS NULL
    OR actor_app_id IS NULL
    OR actor_organization_id IS NULL
    OR hive.is_platform_admin()
    OR NOT hive.has_trusted_organization_context()
  THEN
    RAISE EXCEPTION 'USAGE_COST_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  IF target_operation_id IS NULL
    OR char_length(target_operation_id) NOT BETWEEN 1 AND 200
    OR target_operation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    OR target_idempotency_key IS NULL
    OR char_length(target_idempotency_key) NOT BETWEEN 8 AND 128
    OR target_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    OR target_event_kind NOT IN ('DEBIT', 'CREDIT')
    OR target_usage_code IS NULL
    OR target_usage_code !~ '^[A-Z][A-Z0-9_]{2,127}$'
    OR target_quantity IS NULL
    OR target_quantity <= 0
    OR target_quantity > 9999999999999999.99999999
    OR target_unit_code IS NULL
    OR target_unit_code !~ '^[A-Z][A-Z0-9_]{1,31}$'
    OR (target_capability_code IS NOT NULL AND target_capability_code !~ '^[A-Z][A-Z0-9_]{2,127}$')
    OR (target_cycle_id IS NOT NULL AND (
      char_length(target_cycle_id) NOT BETWEEN 1 AND 128
      OR target_cycle_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    ))
    OR (target_provider_code IS NOT NULL AND target_provider_code !~ '^[A-Z][A-Z0-9_]{1,63}$')
    OR (target_service_code IS NOT NULL AND target_service_code !~ '^[A-Z][A-Z0-9_]{1,63}$')
    OR jsonb_typeof(safe_metadata) <> 'object'
    OR octet_length(safe_metadata::text) > 2048
    OR safe_metadata ?| ARRAY[
      'authorization', 'content', 'cookie', 'document', 'password', 'payload',
      'prompt', 'secret', 'signature', 'token'
    ]
  THEN
    RAISE EXCEPTION 'USAGE_COST_INVALID_INPUT' USING ERRCODE = 'P0001';
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
    RAISE EXCEPTION 'USAGE_COST_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  IF target_budget_id IS NOT NULL THEN
    SELECT budget.*
    INTO selected_budget
    FROM hive.usage_budgets AS budget
    WHERE budget.id = target_budget_id
      AND budget.project_id = selected_project.id
      AND budget.owner_user_id = actor_user_id
      AND budget.app_id = actor_app_id
      AND budget.organization_id = actor_organization_id
      AND budget.measurement_kind = 'USAGE'
      AND budget.unit_code = target_unit_code
      AND budget.status = 'ACTIVE'
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'USAGE_COST_ACCESS_DENIED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  idempotency_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(target_idempotency_key, 'UTF8')),
    'hex'
  );
  fingerprint_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.concat_ws(
        '|', target_project_id::text, COALESCE(target_budget_id::text, ''),
        target_operation_id, target_event_kind, target_usage_code,
        pg_catalog.trim_scale(target_quantity)::text,
        target_unit_code, COALESCE(target_capability_code, ''), COALESCE(target_cycle_id, ''),
        COALESCE(target_provider_code, ''), COALESCE(target_service_code, ''),
        COALESCE(target_occurred_at::text, ''), safe_metadata::text
      ),
      'UTF8'
    )),
    'hex'
  );

  INSERT INTO hive.usage_events (
    organization_id, app_id, project_id, owner_user_id, budget_id,
    operation_id, idempotency_key_sha256, event_fingerprint_sha256,
    event_kind, usage_code, quantity, unit_code, capability_code, cycle_id,
    provider_code, service_code, occurred_at, metadata
  ) VALUES (
    actor_organization_id, actor_app_id, selected_project.id, actor_user_id, target_budget_id,
    target_operation_id, idempotency_hash, fingerprint_hash,
    target_event_kind, target_usage_code, target_quantity, target_unit_code,
    target_capability_code, target_cycle_id, target_provider_code, target_service_code,
    safe_occurred_at, safe_metadata
  )
  ON CONFLICT (organization_id, app_id, project_id, owner_user_id, idempotency_key_sha256)
  DO NOTHING
  RETURNING id INTO created_event_id;

  IF created_event_id IS NULL THEN
    SELECT event.*
    INTO existing_event
    FROM hive.usage_events AS event
    WHERE event.organization_id = actor_organization_id
      AND event.app_id = actor_app_id
      AND event.project_id = selected_project.id
      AND event.owner_user_id = actor_user_id
      AND event.idempotency_key_sha256 = idempotency_hash
    FOR SHARE;
    IF existing_event.event_fingerprint_sha256 <> fingerprint_hash THEN
      RAISE EXCEPTION 'USAGE_COST_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    RETURN existing_event.id;
  END IF;

  RETURN created_event_id;
END;
$$;

CREATE FUNCTION hive.record_cost_event(
  target_project_id uuid,
  target_budget_id uuid,
  target_operation_id text,
  target_idempotency_key text,
  target_event_kind text,
  target_amount numeric,
  target_currency text,
  target_provider_code text,
  target_service_code text,
  target_model_code text,
  target_cycle_id text,
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
  selected_project hive.projects%ROWTYPE;
  selected_budget hive.usage_budgets%ROWTYPE;
  existing_event hive.cost_events%ROWTYPE;
  created_event_id uuid;
  idempotency_hash text;
  fingerprint_hash text;
  safe_occurred_at timestamptz := COALESCE(target_occurred_at, statement_timestamp());
  safe_metadata jsonb := COALESCE(target_metadata, '{}'::jsonb);
BEGIN
  IF actor_user_id IS NULL
    OR actor_app_id IS NULL
    OR actor_organization_id IS NULL
    OR hive.is_platform_admin()
    OR NOT hive.has_trusted_organization_context()
  THEN
    RAISE EXCEPTION 'USAGE_COST_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  IF target_operation_id IS NULL
    OR char_length(target_operation_id) NOT BETWEEN 1 AND 200
    OR target_operation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    OR target_idempotency_key IS NULL
    OR char_length(target_idempotency_key) NOT BETWEEN 8 AND 128
    OR target_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    OR target_event_kind NOT IN ('DEBIT', 'CREDIT')
    OR target_amount IS NULL
    OR target_amount <= 0
    OR target_amount > 9999999999999999.99999999
    OR target_currency IS NULL
    OR target_currency !~ '^[A-Z]{3}$'
    OR target_provider_code IS NULL
    OR target_provider_code !~ '^[A-Z][A-Z0-9_]{1,63}$'
    OR target_service_code IS NULL
    OR target_service_code !~ '^[A-Z][A-Z0-9_]{1,63}$'
    OR (target_model_code IS NOT NULL AND (
      char_length(target_model_code) NOT BETWEEN 1 AND 128
      OR target_model_code !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    ))
    OR (target_cycle_id IS NOT NULL AND (
      char_length(target_cycle_id) NOT BETWEEN 1 AND 128
      OR target_cycle_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    ))
    OR jsonb_typeof(safe_metadata) <> 'object'
    OR octet_length(safe_metadata::text) > 2048
    OR safe_metadata ?| ARRAY[
      'authorization', 'content', 'cookie', 'document', 'password', 'payload',
      'prompt', 'secret', 'signature', 'token'
    ]
  THEN
    RAISE EXCEPTION 'USAGE_COST_INVALID_INPUT' USING ERRCODE = 'P0001';
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
    RAISE EXCEPTION 'USAGE_COST_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  IF target_budget_id IS NOT NULL THEN
    SELECT budget.*
    INTO selected_budget
    FROM hive.usage_budgets AS budget
    WHERE budget.id = target_budget_id
      AND budget.project_id = selected_project.id
      AND budget.owner_user_id = actor_user_id
      AND budget.app_id = actor_app_id
      AND budget.organization_id = actor_organization_id
      AND budget.measurement_kind = 'COST'
      AND budget.unit_code = target_currency
      AND budget.status = 'ACTIVE'
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'USAGE_COST_ACCESS_DENIED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  idempotency_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(target_idempotency_key, 'UTF8')),
    'hex'
  );
  fingerprint_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.concat_ws(
        '|', target_project_id::text, COALESCE(target_budget_id::text, ''),
        target_operation_id, target_event_kind, pg_catalog.trim_scale(target_amount)::text,
        target_currency,
        target_provider_code, target_service_code, COALESCE(target_model_code, ''),
        COALESCE(target_cycle_id, ''), COALESCE(target_occurred_at::text, ''),
        safe_metadata::text
      ),
      'UTF8'
    )),
    'hex'
  );

  INSERT INTO hive.cost_events (
    organization_id, app_id, project_id, owner_user_id, budget_id,
    operation_id, idempotency_key_sha256, event_fingerprint_sha256,
    event_kind, amount, currency, provider_code, service_code, model_code,
    cycle_id, occurred_at, metadata
  ) VALUES (
    actor_organization_id, actor_app_id, selected_project.id, actor_user_id, target_budget_id,
    target_operation_id, idempotency_hash, fingerprint_hash,
    target_event_kind, target_amount, target_currency, target_provider_code,
    target_service_code, target_model_code, target_cycle_id, safe_occurred_at, safe_metadata
  )
  ON CONFLICT (organization_id, app_id, project_id, owner_user_id, idempotency_key_sha256)
  DO NOTHING
  RETURNING id INTO created_event_id;

  IF created_event_id IS NULL THEN
    SELECT event.*
    INTO existing_event
    FROM hive.cost_events AS event
    WHERE event.organization_id = actor_organization_id
      AND event.app_id = actor_app_id
      AND event.project_id = selected_project.id
      AND event.owner_user_id = actor_user_id
      AND event.idempotency_key_sha256 = idempotency_hash
    FOR SHARE;
    IF existing_event.event_fingerprint_sha256 <> fingerprint_hash THEN
      RAISE EXCEPTION 'USAGE_COST_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    RETURN existing_event.id;
  END IF;

  RETURN created_event_id;
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
      'ENTITLEMENT_CHANGED', 'USAGE_BUDGET_CONFIGURED', 'JOB_FAILED',
      'FILE_EXPORTED', 'ADMIN_ACCESS', 'FEATURE_FLAG_CHANGED',
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
      'USAGE_BUDGET', 'PLATFORM'
    )
  );

CREATE FUNCTION audit.capture_usage_budget_configured()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM audit.append_core_event(
    'USAGE_BUDGET_CONFIGURED',
    NEW.organization_id,
    NEW.app_id,
    NEW.project_id,
    'USAGE_BUDGET',
    NEW.id,
    jsonb_build_object(
      'budget_type', NEW.budget_type,
      'measurement_kind', NEW.measurement_kind,
      'unit_code', NEW.unit_code,
      'status', NEW.status
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_usage_budgets_after_insert
AFTER INSERT ON hive.usage_budgets
FOR EACH ROW EXECUTE FUNCTION audit.capture_usage_budget_configured();

REVOKE ALL ON hive.usage_budgets FROM PUBLIC;
REVOKE ALL ON hive.usage_events FROM PUBLIC;
REVOKE ALL ON hive.cost_events FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.configure_usage_budget(
  uuid, text, text, text, numeric, text, timestamptz, timestamptz, text, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.record_usage_event(
  uuid, uuid, text, text, text, text, numeric, text, text, text, text, text, timestamptz, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.record_cost_event(
  uuid, uuid, text, text, text, numeric, text, text, text, text, text, timestamptz, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit.capture_usage_budget_configured() FROM PUBLIC;

ALTER TABLE hive.usage_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.usage_budgets FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.usage_events FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.cost_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.cost_events FORCE ROW LEVEL SECURITY;

CREATE POLICY usage_budgets_owner_or_platform_select
  ON hive.usage_budgets
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

CREATE POLICY usage_events_owner_or_platform_select
  ON hive.usage_events
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

CREATE POLICY cost_events_platform_select
  ON hive.cost_events
  FOR SELECT
  TO authenticated
  USING (hive.is_platform_admin());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT (
      id, organization_id, app_id, project_id, owner_user_id, budget_type,
      measurement_kind, unit_code, ceiling_amount, consumed_amount, reserved_amount,
      cycle_id, period_start, period_end, status, metadata, created_at, updated_at
    ) ON hive.usage_budgets TO authenticated;
    GRANT SELECT (
      id, organization_id, app_id, project_id, owner_user_id, budget_id,
      operation_id, event_kind, usage_code, quantity, unit_code, capability_code,
      cycle_id, provider_code, service_code, occurred_at, metadata, created_at
    ) ON hive.usage_events TO authenticated;
    GRANT SELECT (
      id, organization_id, app_id, project_id, owner_user_id, budget_id,
      operation_id, event_kind, amount, currency, provider_code, service_code,
      model_code, cycle_id, occurred_at, metadata, created_at
    ) ON hive.cost_events TO authenticated;
    REVOKE ALL ON FUNCTION hive.configure_usage_budget(
      uuid, text, text, text, numeric, text, timestamptz, timestamptz, text, jsonb
    ) FROM authenticated;
    REVOKE ALL ON FUNCTION hive.record_usage_event(
      uuid, uuid, text, text, text, text, numeric, text, text, text, text, text,
      timestamptz, jsonb
    ) FROM authenticated;
    REVOKE ALL ON FUNCTION hive.record_cost_event(
      uuid, uuid, text, text, text, numeric, text, text, text, text, text,
      timestamptz, jsonb
    ) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION hive.configure_usage_budget(
      uuid, text, text, text, numeric, text, timestamptz, timestamptz, text, jsonb
    ) TO service_role;
    GRANT EXECUTE ON FUNCTION hive.record_usage_event(
      uuid, uuid, text, text, text, text, numeric, text, text, text, text, text,
      timestamptz, jsonb
    ) TO service_role;
    GRANT EXECUTE ON FUNCTION hive.record_cost_event(
      uuid, uuid, text, text, text, numeric, text, text, text, text, text,
      timestamptz, jsonb
    ) TO service_role;
  END IF;
END;
$$;

COMMENT ON TABLE hive.usage_budgets IS
  'Project-scoped exact-decimal ceilings. Reservation and consumption decisions remain GH-0402.';
COMMENT ON TABLE hive.usage_events IS
  'Append-only logical consumption events written only by trusted server operations.';
COMMENT ON TABLE hive.cost_events IS
  'Append-only monetary cost events kept separate from logical usage and hidden from project owners.';
COMMENT ON FUNCTION hive.configure_usage_budget(
  uuid, text, text, text, numeric, text, timestamptz, timestamptz, text, jsonb
) IS 'Internal idempotent GH-0401 budget configuration boundary; no reserve or decision behavior.';
COMMENT ON FUNCTION hive.record_usage_event(
  uuid, uuid, text, text, text, text, numeric, text, text, text, text, text, timestamptz, jsonb
) IS 'Internal idempotent append-only logical usage recorder.';
COMMENT ON FUNCTION hive.record_cost_event(
  uuid, uuid, text, text, text, numeric, text, text, text, text, text, timestamptz, jsonb
) IS 'Internal idempotent append-only exact-decimal monetary cost recorder.';
