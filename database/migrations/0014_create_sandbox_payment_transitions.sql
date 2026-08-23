-- green_hive_migration: 0014
-- checkpoint: GH-0302
-- description: Add provider-neutral payment and refund transitions for the deterministic sandbox adapter.
-- rollback_strategy: FORWARD_FIX_OR_VERIFIED_COMMERCIAL_LEDGER_EXPORT_RESTORE

ALTER TABLE hive.payments
  ADD COLUMN provider_refund_id text,
  ADD COLUMN refunded_amount numeric(20, 6);

ALTER TABLE hive.payments
  ADD CONSTRAINT payments_provider_refund_id_check CHECK (
    provider_refund_id IS NULL OR char_length(provider_refund_id) BETWEEN 1 AND 240
  ),
  ADD CONSTRAINT payments_refunded_amount_check CHECK (
    refunded_amount IS NULL OR (refunded_amount >= 0 AND refunded_amount <= amount)
  );

ALTER TABLE hive.payments
  DROP CONSTRAINT payments_lifecycle_check;

ALTER TABLE hive.payments
  ADD CONSTRAINT payments_lifecycle_check CHECK (
    (
      status = 'PENDING'
      AND provider_code IS NULL
      AND provider_payment_id IS NULL
      AND provider_refund_id IS NULL
      AND failure_code IS NULL
      AND confirmed_at IS NULL
      AND failed_at IS NULL
      AND refunded_at IS NULL
      AND refunded_amount IS NULL
    )
    OR (
      status = 'PAID'
      AND provider_code IS NOT NULL
      AND provider_payment_id IS NOT NULL
      AND provider_refund_id IS NULL
      AND failure_code IS NULL
      AND confirmed_at IS NOT NULL
      AND failed_at IS NULL
      AND refunded_at IS NULL
      AND refunded_amount IS NULL
    )
    OR (
      status = 'FAILED'
      AND provider_code IS NOT NULL
      AND provider_payment_id IS NOT NULL
      AND provider_refund_id IS NULL
      AND failure_code IS NOT NULL
      AND confirmed_at IS NULL
      AND failed_at IS NOT NULL
      AND refunded_at IS NULL
      AND refunded_amount IS NULL
    )
    OR (
      status = 'REFUNDED'
      AND provider_code IS NOT NULL
      AND provider_payment_id IS NOT NULL
      AND provider_refund_id IS NOT NULL
      AND failure_code IS NULL
      AND confirmed_at IS NOT NULL
      AND failed_at IS NULL
      AND refunded_at IS NOT NULL
      AND refunded_amount = amount
    )
    OR (
      status = 'PARTIALLY_REFUNDED'
      AND provider_code IS NOT NULL
      AND provider_payment_id IS NOT NULL
      AND provider_refund_id IS NOT NULL
      AND failure_code IS NULL
      AND confirmed_at IS NOT NULL
      AND failed_at IS NULL
      AND refunded_at IS NOT NULL
      AND refunded_amount > 0
      AND refunded_amount < amount
    )
    OR (
      status = 'DISPUTED'
      AND provider_code IS NOT NULL
      AND provider_payment_id IS NOT NULL
      AND confirmed_at IS NOT NULL
      AND failed_at IS NULL
    )
  );

CREATE UNIQUE INDEX payments_provider_refund_reference_unique
  ON hive.payments (provider_code, provider_refund_id)
  WHERE provider_code IS NOT NULL AND provider_refund_id IS NOT NULL;

CREATE FUNCTION hive.apply_provider_payment_result(
  target_purchase_id uuid,
  target_provider_code text,
  target_provider_payment_id text,
  target_outcome text,
  target_failure_code text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_user_id uuid;
  actor_app_id uuid;
  actor_organization_id uuid;
  selected_purchase hive.purchases%ROWTYPE;
  selected_payment hive.payments%ROWTYPE;
  transition_time timestamptz := statement_timestamp();
BEGIN
  actor_user_id := auth.uid();
  actor_app_id := hive.current_app_id();
  actor_organization_id := hive.current_organization_id();

  IF actor_user_id IS NULL
    OR actor_app_id IS NULL
    OR actor_organization_id IS NULL
    OR hive.is_platform_admin()
    OR NOT hive.has_trusted_organization_context()
  THEN
    RAISE EXCEPTION 'BILLING_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  IF target_provider_code IS NULL
    OR target_provider_code !~ '^[A-Z][A-Z0-9_]{1,63}$'
    OR target_provider_payment_id IS NULL
    OR char_length(target_provider_payment_id) NOT BETWEEN 1 AND 240
    OR target_outcome NOT IN ('PAID', 'FAILED')
    OR (
      target_outcome = 'FAILED'
      AND (
        target_failure_code IS NULL
        OR target_failure_code !~ '^[A-Z][A-Z0-9_]{1,127}$'
      )
    )
    OR (target_outcome = 'PAID' AND target_failure_code IS NOT NULL)
  THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  SELECT purchase.*
  INTO selected_purchase
  FROM hive.purchases AS purchase
  WHERE purchase.id = target_purchase_id
    AND purchase.owner_user_id = actor_user_id
    AND purchase.app_id = actor_app_id
    AND purchase.organization_id = actor_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BILLING_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  SELECT payment.*
  INTO selected_payment
  FROM hive.payments AS payment
  WHERE payment.purchase_id = selected_purchase.id
  ORDER BY payment.attempt_number DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  IF selected_payment.status = target_outcome THEN
    IF selected_payment.provider_code = target_provider_code
      AND selected_payment.provider_payment_id = target_provider_payment_id
      AND selected_payment.failure_code IS NOT DISTINCT FROM target_failure_code
      AND (
        (target_outcome = 'PAID' AND selected_purchase.status = 'CONFIRMED')
        OR (target_outcome = 'FAILED' AND selected_purchase.status = 'CANCELED')
      )
    THEN
      RETURN selected_purchase.id;
    END IF;
    RAISE EXCEPTION 'INVALID_PAYMENT_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  IF selected_purchase.status <> 'PENDING' OR selected_payment.status <> 'PENDING' THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  IF target_outcome = 'PAID' THEN
    UPDATE hive.payments
    SET status = 'PAID',
        provider_code = target_provider_code,
        provider_payment_id = target_provider_payment_id,
        failure_code = NULL,
        confirmed_at = transition_time,
        failed_at = NULL,
        updated_at = transition_time
    WHERE id = selected_payment.id;

    UPDATE hive.purchases
    SET status = 'CONFIRMED',
        confirmed_at = transition_time,
        canceled_at = NULL,
        updated_at = transition_time
    WHERE id = selected_purchase.id;
  ELSE
    UPDATE hive.payments
    SET status = 'FAILED',
        provider_code = target_provider_code,
        provider_payment_id = target_provider_payment_id,
        failure_code = target_failure_code,
        confirmed_at = NULL,
        failed_at = transition_time,
        updated_at = transition_time
    WHERE id = selected_payment.id;

    UPDATE hive.purchases
    SET status = 'CANCELED',
        confirmed_at = NULL,
        canceled_at = transition_time,
        updated_at = transition_time
    WHERE id = selected_purchase.id;
  END IF;

  RETURN selected_purchase.id;
END;
$$;

CREATE FUNCTION hive.apply_provider_refund(
  target_purchase_id uuid,
  target_provider_code text,
  target_provider_refund_id text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_user_id uuid;
  actor_app_id uuid;
  actor_organization_id uuid;
  selected_purchase hive.purchases%ROWTYPE;
  selected_payment hive.payments%ROWTYPE;
  transition_time timestamptz := statement_timestamp();
BEGIN
  actor_user_id := auth.uid();
  actor_app_id := hive.current_app_id();
  actor_organization_id := hive.current_organization_id();

  IF actor_user_id IS NULL
    OR actor_app_id IS NULL
    OR actor_organization_id IS NULL
    OR hive.is_platform_admin()
    OR NOT hive.has_trusted_organization_context()
  THEN
    RAISE EXCEPTION 'BILLING_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  IF target_provider_code IS NULL
    OR target_provider_code !~ '^[A-Z][A-Z0-9_]{1,63}$'
    OR target_provider_refund_id IS NULL
    OR char_length(target_provider_refund_id) NOT BETWEEN 1 AND 240
  THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  SELECT purchase.*
  INTO selected_purchase
  FROM hive.purchases AS purchase
  WHERE purchase.id = target_purchase_id
    AND purchase.owner_user_id = actor_user_id
    AND purchase.app_id = actor_app_id
    AND purchase.organization_id = actor_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BILLING_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  SELECT payment.*
  INTO selected_payment
  FROM hive.payments AS payment
  WHERE payment.purchase_id = selected_purchase.id
  ORDER BY payment.attempt_number DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  IF selected_payment.status = 'REFUNDED' THEN
    IF selected_purchase.status = 'CONFIRMED'
      AND selected_payment.provider_code = target_provider_code
      AND selected_payment.provider_refund_id = target_provider_refund_id
      AND selected_payment.refunded_amount = selected_payment.amount
    THEN
      RETURN selected_purchase.id;
    END IF;
    RAISE EXCEPTION 'INVALID_PAYMENT_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  IF selected_purchase.status <> 'CONFIRMED'
    OR selected_payment.status <> 'PAID'
    OR selected_payment.provider_code <> target_provider_code
    OR selected_payment.provider_payment_id IS NULL
  THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  UPDATE hive.payments
  SET status = 'REFUNDED',
      provider_refund_id = target_provider_refund_id,
      refunded_amount = amount,
      refunded_at = transition_time,
      updated_at = transition_time
  WHERE id = selected_payment.id;

  RETURN selected_purchase.id;
END;
$$;

ALTER TABLE audit.events
  DROP CONSTRAINT audit_events_event_code_check;

ALTER TABLE audit.events
  ADD CONSTRAINT audit_events_event_code_check CHECK (
    event_code IN (
      'LOGIN_SUCCESS',
      'LOGIN_FAILED',
      'ORGANIZATION_CREATED',
      'ORGANIZATION_MEMBER_ADDED',
      'ORGANIZATION_MEMBER_CHANGED',
      'ORGANIZATION_APP_INSTALLED',
      'PROJECT_CREATED',
      'PROJECT_ARCHIVED',
      'PROJECT_DELETION_REQUESTED',
      'PURCHASE_CREATED',
      'PAYMENT_CONFIRMED',
      'PAYMENT_FAILED',
      'PAYMENT_REFUNDED',
      'ENTITLEMENT_GRANTED',
      'ENTITLEMENT_CHANGED',
      'JOB_FAILED',
      'FILE_EXPORTED',
      'ADMIN_ACCESS',
      'FEATURE_FLAG_CHANGED',
      'PROVIDER_STATUS_CHANGED'
    )
  );

CREATE FUNCTION audit.capture_payment_transition()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_event_code text;
  target_outcome text;
  current_actor_user_id uuid;
  current_actor_type text;
  current_request_id uuid;
  current_correlation_id uuid;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  ELSIF OLD.status = 'PENDING' AND NEW.status = 'PAID' THEN
    target_event_code := 'PAYMENT_CONFIRMED';
    target_outcome := 'SUCCEEDED';
  ELSIF OLD.status = 'PENDING' AND NEW.status = 'FAILED' THEN
    target_event_code := 'PAYMENT_FAILED';
    target_outcome := 'FAILED';
  ELSIF OLD.status = 'PAID' AND NEW.status = 'REFUNDED' THEN
    target_event_code := 'PAYMENT_REFUNDED';
    target_outcome := 'SUCCEEDED';
  ELSE
    RETURN NEW;
  END IF;

  current_actor_user_id := auth.uid();
  current_actor_type := CASE
    WHEN current_actor_user_id IS NULL THEN 'SYSTEM'
    WHEN hive.is_platform_admin() THEN 'PLATFORM_ADMIN'
    ELSE 'USER'
  END;
  current_request_id := audit.context_uuid('request.green_hive.request_id');
  IF current_request_id IS NULL THEN
    current_request_id := gen_random_uuid();
  END IF;
  current_correlation_id := audit.context_uuid('request.green_hive.correlation_id');
  IF current_correlation_id IS NULL THEN
    current_correlation_id := current_request_id;
  END IF;

  INSERT INTO audit.events (
    event_code,
    actor_user_id,
    actor_type,
    organization_id,
    app_id,
    project_id,
    subject_type,
    subject_id,
    outcome,
    request_id,
    correlation_id,
    metadata
  )
  VALUES (
    target_event_code,
    current_actor_user_id,
    current_actor_type,
    NEW.organization_id,
    NEW.app_id,
    NEW.project_id,
    'PAYMENT',
    NEW.id,
    target_outcome,
    current_request_id,
    current_correlation_id,
    jsonb_strip_nulls(jsonb_build_object(
      'provider_code', NEW.provider_code,
      'status', NEW.status,
      'failure_code', NEW.failure_code
    ))
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_payments_after_transition
AFTER UPDATE OF status ON hive.payments
FOR EACH ROW EXECUTE FUNCTION audit.capture_payment_transition();

REVOKE ALL ON FUNCTION hive.apply_provider_payment_result(uuid, text, text, text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.apply_provider_refund(uuid, text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION audit.capture_payment_transition() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT (refunded_amount) ON hive.payments TO authenticated;
    REVOKE ALL ON FUNCTION hive.apply_provider_payment_result(uuid, text, text, text, text)
      FROM authenticated;
    REVOKE ALL ON FUNCTION hive.apply_provider_refund(uuid, text, text)
      FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION hive.apply_provider_payment_result(uuid, text, text, text, text)
      TO service_role;
    GRANT EXECUTE ON FUNCTION hive.apply_provider_refund(uuid, text, text)
      TO service_role;
  END IF;
END;
$$;

COMMENT ON FUNCTION hive.apply_provider_payment_result(uuid, text, text, text, text) IS
  'Trusted server transition for a verified provider result. Not executable by authenticated clients.';
COMMENT ON FUNCTION hive.apply_provider_refund(uuid, text, text) IS
  'Trusted server transition for a verified full refund. Not executable by authenticated clients.';
COMMENT ON COLUMN hive.payments.provider_refund_id IS
  'Opaque provider refund reference only; never a credential or payment-card data.';
COMMENT ON COLUMN hive.payments.refunded_amount IS
  'Exact refunded amount retained as numeric commercial truth.';
