-- green_hive_migration: 0015
-- checkpoint: GH-0303
-- description: Create verified idempotent payment webhook ingestion and provider-event reconciliation records.
-- rollback_strategy: FORWARD_FIX_OR_VERIFIED_PROVIDER_EVENT_EXPORT_RESTORE

ALTER TABLE hive.payments
  ADD CONSTRAINT payments_id_purchase_unique UNIQUE (id, purchase_id);

CREATE TABLE hive.payment_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  purchase_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  provider_payment_id text NOT NULL,
  provider_refund_id text,
  failure_code text,
  payload_sha256 text NOT NULL,
  effect text NOT NULL,
  delivery_count integer NOT NULL DEFAULT 1,
  first_received_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  last_received_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  processed_at timestamptz NOT NULL,
  CONSTRAINT payment_provider_events_identity_unique
    UNIQUE (provider_code, provider_event_id),
  CONSTRAINT payment_provider_events_purchase_fk
    FOREIGN KEY (purchase_id)
    REFERENCES hive.purchases(id)
    ON DELETE RESTRICT,
  CONSTRAINT payment_provider_events_payment_purchase_fk
    FOREIGN KEY (payment_id, purchase_id)
    REFERENCES hive.payments(id, purchase_id)
    ON DELETE RESTRICT,
  CONSTRAINT payment_provider_events_provider_code_check CHECK (
    provider_code ~ '^[A-Z][A-Z0-9_]{1,63}$'
  ),
  CONSTRAINT payment_provider_events_provider_event_id_check CHECK (
    char_length(provider_event_id) BETWEEN 1 AND 240
  ),
  CONSTRAINT payment_provider_events_event_type_check CHECK (
    event_type IN ('PAYMENT_PAID', 'PAYMENT_FAILED', 'PAYMENT_REFUNDED')
  ),
  CONSTRAINT payment_provider_events_provider_payment_id_check CHECK (
    char_length(provider_payment_id) BETWEEN 1 AND 240
  ),
  CONSTRAINT payment_provider_events_provider_refund_id_check CHECK (
    provider_refund_id IS NULL OR char_length(provider_refund_id) BETWEEN 1 AND 240
  ),
  CONSTRAINT payment_provider_events_failure_code_check CHECK (
    failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{1,127}$'
  ),
  CONSTRAINT payment_provider_events_payload_hash_check CHECK (
    payload_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT payment_provider_events_effect_check CHECK (
    effect IN ('PAYMENT_CONFIRMED', 'PAYMENT_FAILED', 'PAYMENT_REFUNDED', 'NO_CHANGE')
  ),
  CONSTRAINT payment_provider_events_delivery_count_check CHECK (delivery_count > 0),
  CONSTRAINT payment_provider_events_received_order_check CHECK (
    last_received_at >= first_received_at AND processed_at >= first_received_at
  ),
  CONSTRAINT payment_provider_events_shape_check CHECK (
    (
      event_type = 'PAYMENT_PAID'
      AND provider_refund_id IS NULL
      AND failure_code IS NULL
    )
    OR (
      event_type = 'PAYMENT_FAILED'
      AND provider_refund_id IS NULL
      AND failure_code IS NOT NULL
    )
    OR (
      event_type = 'PAYMENT_REFUNDED'
      AND provider_refund_id IS NOT NULL
      AND failure_code IS NULL
    )
  )
);

CREATE INDEX payment_provider_events_purchase_received_idx
  ON hive.payment_provider_events (purchase_id, first_received_at DESC, id);

CREATE FUNCTION hive.apply_verified_payment_webhook(
  target_provider_code text,
  target_provider_event_id text,
  target_event_type text,
  target_purchase_id uuid,
  target_provider_payment_id text,
  target_payload_sha256 text,
  target_provider_refund_id text DEFAULT NULL,
  target_failure_code text DEFAULT NULL
)
RETURNS TABLE (
  event_record_id uuid,
  provider_event_id text,
  purchase_id uuid,
  payment_id uuid,
  effect text,
  duplicate boolean,
  delivery_count integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  existing_event hive.payment_provider_events%ROWTYPE;
  selected_purchase hive.purchases%ROWTYPE;
  selected_payment hive.payments%ROWTYPE;
  target_effect text;
  received_at timestamptz := statement_timestamp();
BEGIN
  IF target_provider_code IS NULL
    OR target_provider_code !~ '^[A-Z][A-Z0-9_]{1,63}$'
    OR target_provider_event_id IS NULL
    OR char_length(target_provider_event_id) NOT BETWEEN 1 AND 240
    OR target_event_type NOT IN ('PAYMENT_PAID', 'PAYMENT_FAILED', 'PAYMENT_REFUNDED')
    OR target_purchase_id IS NULL
    OR target_provider_payment_id IS NULL
    OR char_length(target_provider_payment_id) NOT BETWEEN 1 AND 240
    OR target_payload_sha256 IS NULL
    OR target_payload_sha256 !~ '^[0-9a-f]{64}$'
    OR (
      target_event_type = 'PAYMENT_PAID'
      AND (target_provider_refund_id IS NOT NULL OR target_failure_code IS NOT NULL)
    )
    OR (
      target_event_type = 'PAYMENT_FAILED'
      AND (
        target_provider_refund_id IS NOT NULL
        OR target_failure_code IS NULL
        OR target_failure_code !~ '^[A-Z][A-Z0-9_]{1,127}$'
      )
    )
    OR (
      target_event_type = 'PAYMENT_REFUNDED'
      AND (
        target_provider_refund_id IS NULL
        OR char_length(target_provider_refund_id) NOT BETWEEN 1 AND 240
        OR target_failure_code IS NOT NULL
      )
    )
  THEN
    RAISE EXCEPTION 'INVALID_BILLING_WEBHOOK_INPUT' USING ERRCODE = 'P0001';
  END IF;

  SELECT provider_event.*
  INTO existing_event
  FROM hive.payment_provider_events AS provider_event
  WHERE provider_event.provider_code = target_provider_code
    AND provider_event.provider_event_id = target_provider_event_id
  FOR UPDATE;

  IF FOUND THEN
    IF existing_event.event_type = target_event_type
      AND existing_event.purchase_id = target_purchase_id
      AND existing_event.provider_payment_id = target_provider_payment_id
      AND existing_event.provider_refund_id IS NOT DISTINCT FROM target_provider_refund_id
      AND existing_event.failure_code IS NOT DISTINCT FROM target_failure_code
      AND existing_event.payload_sha256 = target_payload_sha256
    THEN
      UPDATE hive.payment_provider_events AS provider_event
      SET delivery_count = provider_event.delivery_count + 1,
          last_received_at = received_at
      WHERE provider_event.id = existing_event.id
      RETURNING provider_event.delivery_count INTO existing_event.delivery_count;

      RETURN QUERY SELECT
        existing_event.id,
        existing_event.provider_event_id,
        existing_event.purchase_id,
        existing_event.payment_id,
        existing_event.effect,
        true,
        existing_event.delivery_count;
      RETURN;
    END IF;
    RAISE EXCEPTION 'BILLING_WEBHOOK_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  SELECT purchase.*
  INTO selected_purchase
  FROM hive.purchases AS purchase
  WHERE purchase.id = target_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_BILLING_WEBHOOK_INPUT' USING ERRCODE = 'P0001';
  END IF;

  SELECT provider_event.*
  INTO existing_event
  FROM hive.payment_provider_events AS provider_event
  WHERE provider_event.provider_code = target_provider_code
    AND provider_event.provider_event_id = target_provider_event_id
  FOR UPDATE;

  IF FOUND THEN
    IF existing_event.event_type = target_event_type
      AND existing_event.purchase_id = target_purchase_id
      AND existing_event.provider_payment_id = target_provider_payment_id
      AND existing_event.provider_refund_id IS NOT DISTINCT FROM target_provider_refund_id
      AND existing_event.failure_code IS NOT DISTINCT FROM target_failure_code
      AND existing_event.payload_sha256 = target_payload_sha256
    THEN
      UPDATE hive.payment_provider_events AS provider_event
      SET delivery_count = provider_event.delivery_count + 1,
          last_received_at = received_at
      WHERE provider_event.id = existing_event.id
      RETURNING provider_event.delivery_count INTO existing_event.delivery_count;

      RETURN QUERY SELECT
        existing_event.id,
        existing_event.provider_event_id,
        existing_event.purchase_id,
        existing_event.payment_id,
        existing_event.effect,
        true,
        existing_event.delivery_count;
      RETURN;
    END IF;
    RAISE EXCEPTION 'BILLING_WEBHOOK_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  SELECT payment.*
  INTO selected_payment
  FROM hive.payments AS payment
  WHERE payment.purchase_id = selected_purchase.id
  ORDER BY payment.attempt_number DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND
    OR (selected_payment.provider_code IS NOT NULL
      AND selected_payment.provider_code <> target_provider_code)
    OR (selected_payment.provider_payment_id IS NOT NULL
      AND selected_payment.provider_payment_id <> target_provider_payment_id)
  THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  IF target_event_type = 'PAYMENT_PAID' THEN
    IF selected_purchase.status = 'PENDING' AND selected_payment.status = 'PENDING' THEN
      UPDATE hive.payments
      SET status = 'PAID',
          provider_code = target_provider_code,
          provider_payment_id = target_provider_payment_id,
          provider_event_id = target_provider_event_id,
          failure_code = NULL,
          confirmed_at = received_at,
          failed_at = NULL,
          updated_at = received_at
      WHERE id = selected_payment.id;

      UPDATE hive.purchases
      SET status = 'CONFIRMED',
          confirmed_at = received_at,
          canceled_at = NULL,
          updated_at = received_at
      WHERE id = selected_purchase.id;
      target_effect := 'PAYMENT_CONFIRMED';
    ELSIF selected_purchase.status = 'CONFIRMED'
      AND selected_payment.status = 'PAID'
      AND selected_payment.provider_code = target_provider_code
      AND selected_payment.provider_payment_id = target_provider_payment_id
    THEN
      target_effect := 'NO_CHANGE';
    ELSE
      RAISE EXCEPTION 'INVALID_PAYMENT_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
  ELSIF target_event_type = 'PAYMENT_FAILED' THEN
    IF selected_purchase.status = 'PENDING' AND selected_payment.status = 'PENDING' THEN
      UPDATE hive.payments
      SET status = 'FAILED',
          provider_code = target_provider_code,
          provider_payment_id = target_provider_payment_id,
          provider_event_id = target_provider_event_id,
          failure_code = target_failure_code,
          confirmed_at = NULL,
          failed_at = received_at,
          updated_at = received_at
      WHERE id = selected_payment.id;

      UPDATE hive.purchases
      SET status = 'CANCELED',
          confirmed_at = NULL,
          canceled_at = received_at,
          updated_at = received_at
      WHERE id = selected_purchase.id;
      target_effect := 'PAYMENT_FAILED';
    ELSIF selected_purchase.status = 'CANCELED'
      AND selected_payment.status = 'FAILED'
      AND selected_payment.provider_code = target_provider_code
      AND selected_payment.provider_payment_id = target_provider_payment_id
      AND selected_payment.failure_code = target_failure_code
    THEN
      target_effect := 'NO_CHANGE';
    ELSE
      RAISE EXCEPTION 'INVALID_PAYMENT_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF selected_purchase.status = 'CONFIRMED'
      AND selected_payment.status = 'PAID'
      AND selected_payment.provider_code = target_provider_code
      AND selected_payment.provider_payment_id = target_provider_payment_id
    THEN
      UPDATE hive.payments
      SET status = 'REFUNDED',
          provider_refund_id = target_provider_refund_id,
          refunded_amount = amount,
          refunded_at = received_at,
          updated_at = received_at
      WHERE id = selected_payment.id;
      target_effect := 'PAYMENT_REFUNDED';
    ELSIF selected_purchase.status = 'CONFIRMED'
      AND selected_payment.status = 'REFUNDED'
      AND selected_payment.provider_code = target_provider_code
      AND selected_payment.provider_payment_id = target_provider_payment_id
      AND selected_payment.provider_refund_id = target_provider_refund_id
      AND selected_payment.refunded_amount = selected_payment.amount
    THEN
      target_effect := 'NO_CHANGE';
    ELSE
      RAISE EXCEPTION 'INVALID_PAYMENT_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO hive.payment_provider_events (
    provider_code,
    provider_event_id,
    event_type,
    purchase_id,
    payment_id,
    provider_payment_id,
    provider_refund_id,
    failure_code,
    payload_sha256,
    effect,
    delivery_count,
    first_received_at,
    last_received_at,
    processed_at
  )
  VALUES (
    target_provider_code,
    target_provider_event_id,
    target_event_type,
    selected_purchase.id,
    selected_payment.id,
    target_provider_payment_id,
    target_provider_refund_id,
    target_failure_code,
    target_payload_sha256,
    target_effect,
    1,
    received_at,
    received_at,
    received_at
  )
  RETURNING id INTO event_record_id;

  provider_event_id := target_provider_event_id;
  purchase_id := selected_purchase.id;
  payment_id := selected_payment.id;
  effect := target_effect;
  duplicate := false;
  delivery_count := 1;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON hive.payment_provider_events FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.apply_verified_payment_webhook(
  text, text, text, uuid, text, text, text, text
) FROM PUBLIC;

ALTER TABLE hive.payment_provider_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.payment_provider_events FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON hive.payment_provider_events FROM authenticated;
    REVOKE ALL ON FUNCTION hive.apply_verified_payment_webhook(
      text, text, text, uuid, text, text, text, text
    ) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION hive.apply_verified_payment_webhook(
      text, text, text, uuid, text, text, text, text
    ) TO service_role;
  END IF;
END;
$$;

COMMENT ON TABLE hive.payment_provider_events IS
  'Verified provider-event identities and minimal processing metadata. Raw webhook payloads and signatures are never stored.';
COMMENT ON COLUMN hive.payment_provider_events.payload_sha256 IS
  'SHA-256 of the exact verified raw payload for duplicate-conflict detection; the payload itself is not retained.';
COMMENT ON FUNCTION hive.apply_verified_payment_webhook(
  text, text, text, uuid, text, text, text, text
) IS
  'Server-only transition for an already signature-verified provider event with atomic duplicate single-effect handling.';
