DO $$
DECLARE
  reference_app_id constant uuid := '00000000-0000-4000-8000-000000000001'::uuid;
  reference_job_registration_id constant uuid := '70000000-0000-4000-8000-000000000001'::uuid;
  registered_app hive.apps%ROWTYPE;
  conflicting_registration hive.job_registrations%ROWTYPE;
BEGIN
  SELECT app.*
  INTO registered_app
  FROM hive.apps AS app
  WHERE app.app_code = 'REFERENCE_APP';

  IF NOT FOUND OR registered_app.id <> reference_app_id THEN
    RAISE EXCEPTION 'REFERENCE_APP job seed requires the canonical app identity';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(registered_app.manifest -> 'jobTypes') AS declared(job_type)
    WHERE declared.job_type = 'REFERENCE_APP_FAKE_AI_JOB'
  ) THEN
    RAISE EXCEPTION 'REFERENCE_APP job seed requires its canonical manifest registration';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(
      registered_app.manifest -> 'entitlementCapabilities'
    ) AS declared(capability_code)
    WHERE declared.capability_code = 'REFERENCE_APP_RUN_JOB'
  ) THEN
    RAISE EXCEPTION 'REFERENCE_APP job seed requires its canonical entitlement capability';
  END IF;

  SELECT registration.*
  INTO conflicting_registration
  FROM hive.job_registrations AS registration
  WHERE registration.id = reference_job_registration_id
     OR registration.job_type = 'REFERENCE_APP_FAKE_AI_JOB';

  IF FOUND AND (
    conflicting_registration.id <> reference_job_registration_id
    OR conflicting_registration.app_id <> reference_app_id
    OR conflicting_registration.job_type <> 'REFERENCE_APP_FAKE_AI_JOB'
  ) THEN
    RAISE EXCEPTION 'REFERENCE_APP job seed conflicts with an incompatible registration identity';
  END IF;

  INSERT INTO hive.job_registrations (
    id,
    app_id,
    job_type,
    handler_owner,
    required_capability,
    cost_budget_type,
    exclusive_scope,
    idempotency_strategy,
    retry_policy,
    max_attempts,
    timeout_class,
    active
  ) VALUES (
    reference_job_registration_id,
    reference_app_id,
    'REFERENCE_APP_FAKE_AI_JOB',
    'REFERENCE_APP',
    'REFERENCE_APP_RUN_JOB',
    'AI',
    NULL,
    'PROJECT_OWNER_KEY',
    'EXPONENTIAL_BACKOFF',
    3,
    'SHORT',
    true
  )
  ON CONFLICT (app_id, job_type)
  DO UPDATE SET
    handler_owner = EXCLUDED.handler_owner,
    required_capability = EXCLUDED.required_capability,
    cost_budget_type = EXCLUDED.cost_budget_type,
    exclusive_scope = EXCLUDED.exclusive_scope,
    idempotency_strategy = EXCLUDED.idempotency_strategy,
    retry_policy = EXCLUDED.retry_policy,
    max_attempts = EXCLUDED.max_attempts,
    timeout_class = EXCLUDED.timeout_class,
    active = EXCLUDED.active,
    updated_at = now();
END;
$$;

DO $$
DECLARE
  reference_app_id constant uuid := '00000000-0000-4000-8000-000000000001'::uuid;
  reference_render_job_id constant uuid := '70000000-0000-4000-8000-000000000002'::uuid;
  registered_app hive.apps%ROWTYPE;
  conflicting_registration hive.job_registrations%ROWTYPE;
BEGIN
  SELECT app.* INTO registered_app
  FROM hive.apps AS app WHERE app.app_code = 'REFERENCE_APP';

  IF NOT FOUND OR registered_app.id <> reference_app_id
    OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(registered_app.manifest -> 'jobTypes') AS declared(job_type)
      WHERE declared.job_type = 'REFERENCE_APP_RENDER_PROJECT_DOCUMENT'
    )
  THEN
    RAISE EXCEPTION 'REFERENCE_APP render job seed requires its canonical app and manifest registration';
  END IF;

  SELECT registration.* INTO conflicting_registration
  FROM hive.job_registrations AS registration
  WHERE registration.id = reference_render_job_id
     OR registration.job_type = 'REFERENCE_APP_RENDER_PROJECT_DOCUMENT';

  IF FOUND AND (
    conflicting_registration.id <> reference_render_job_id
    OR conflicting_registration.app_id <> reference_app_id
    OR conflicting_registration.job_type <> 'REFERENCE_APP_RENDER_PROJECT_DOCUMENT'
  ) THEN
    RAISE EXCEPTION 'REFERENCE_APP render job seed conflicts with an incompatible registration identity';
  END IF;

  INSERT INTO hive.job_registrations (
    id, app_id, job_type, handler_owner, required_capability, cost_budget_type,
    exclusive_scope, idempotency_strategy, retry_policy, max_attempts, timeout_class, active
  ) VALUES (
    reference_render_job_id, reference_app_id, 'REFERENCE_APP_RENDER_PROJECT_DOCUMENT',
    'REFERENCE_APP', 'REFERENCE_APP_GENERATE_FILE', 'FILE_PROCESSING', 'PROJECT',
    'PROJECT_OWNER_KEY', 'FIXED', 3, 'MEDIUM', true
  )
  ON CONFLICT (app_id, job_type) DO UPDATE SET
    handler_owner = EXCLUDED.handler_owner,
    required_capability = EXCLUDED.required_capability,
    cost_budget_type = EXCLUDED.cost_budget_type,
    exclusive_scope = EXCLUDED.exclusive_scope,
    idempotency_strategy = EXCLUDED.idempotency_strategy,
    retry_policy = EXCLUDED.retry_policy,
    max_attempts = EXCLUDED.max_attempts,
    timeout_class = EXCLUDED.timeout_class,
    active = EXCLUDED.active,
    updated_at = now();
END;
$$;
