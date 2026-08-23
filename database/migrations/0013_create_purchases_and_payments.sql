-- green_hive_migration: 0013
-- checkpoint: GH-0301
-- description: Create tenant purchase and payment records with server-authoritative pending purchase creation.
-- rollback_strategy: FORWARD_FIX_OR_VERIFIED_COMMERCIAL_LEDGER_EXPORT_RESTORE

ALTER TABLE hive.projects
  ADD CONSTRAINT projects_id_app_organization_owner_unique
  UNIQUE (id, app_id, organization_id, owner_user_id);

CREATE TABLE hive.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  app_id uuid NOT NULL,
  project_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  product_id uuid NOT NULL,
  price_id uuid NOT NULL,
  product_code text NOT NULL,
  price_version integer NOT NULL,
  amount numeric(20, 6) NOT NULL,
  currency text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  idempotency_key_sha256 text NOT NULL,
  confirmed_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchases_project_scope_fk
    FOREIGN KEY (project_id, app_id, organization_id, owner_user_id)
    REFERENCES hive.projects(id, app_id, organization_id, owner_user_id)
    ON DELETE RESTRICT,
  CONSTRAINT purchases_product_app_fk
    FOREIGN KEY (product_id, app_id)
    REFERENCES hive.products(id, app_id)
    ON DELETE RESTRICT,
  CONSTRAINT purchases_price_product_app_fk
    FOREIGN KEY (price_id, product_id, app_id)
    REFERENCES hive.prices(id, product_id, app_id)
    ON DELETE RESTRICT,
  CONSTRAINT purchases_id_scope_unique
    UNIQUE (id, organization_id, app_id, project_id, owner_user_id),
  CONSTRAINT purchases_idempotency_unique
    UNIQUE (organization_id, app_id, owner_user_id, idempotency_key_sha256),
  CONSTRAINT purchases_product_code_check CHECK (
    product_code ~ '^[A-Z][A-Z0-9_]{2,127}$'
  ),
  CONSTRAINT purchases_price_version_check CHECK (price_version > 0),
  CONSTRAINT purchases_amount_check CHECK (amount >= 0),
  CONSTRAINT purchases_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT purchases_status_check CHECK (status IN ('PENDING', 'CONFIRMED', 'CANCELED')),
  CONSTRAINT purchases_idempotency_hash_check CHECK (
    idempotency_key_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT purchases_lifecycle_check CHECK (
    (status = 'PENDING' AND confirmed_at IS NULL AND canceled_at IS NULL)
    OR (status = 'CONFIRMED' AND confirmed_at IS NOT NULL AND canceled_at IS NULL)
    OR (status = 'CANCELED' AND confirmed_at IS NULL AND canceled_at IS NOT NULL)
  )
);

CREATE TABLE hive.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  app_id uuid NOT NULL,
  project_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  attempt_number integer NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  amount numeric(20, 6) NOT NULL,
  currency text NOT NULL,
  provider_code text,
  provider_payment_id text,
  provider_event_id text,
  failure_code text,
  confirmed_at timestamptz,
  failed_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_purchase_scope_fk
    FOREIGN KEY (purchase_id, organization_id, app_id, project_id, owner_user_id)
    REFERENCES hive.purchases(id, organization_id, app_id, project_id, owner_user_id)
    ON DELETE RESTRICT,
  CONSTRAINT payments_purchase_attempt_unique UNIQUE (purchase_id, attempt_number),
  CONSTRAINT payments_attempt_check CHECK (attempt_number > 0),
  CONSTRAINT payments_status_check CHECK (
    status IN ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'DISPUTED')
  ),
  CONSTRAINT payments_amount_check CHECK (amount >= 0),
  CONSTRAINT payments_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT payments_provider_code_check CHECK (
    provider_code IS NULL OR provider_code ~ '^[A-Z][A-Z0-9_]{1,63}$'
  ),
  CONSTRAINT payments_provider_payment_id_check CHECK (
    provider_payment_id IS NULL OR char_length(provider_payment_id) BETWEEN 1 AND 240
  ),
  CONSTRAINT payments_provider_event_id_check CHECK (
    provider_event_id IS NULL OR char_length(provider_event_id) BETWEEN 1 AND 240
  ),
  CONSTRAINT payments_failure_code_check CHECK (
    failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{1,127}$'
  ),
  CONSTRAINT payments_lifecycle_check CHECK (
    (status = 'PENDING' AND confirmed_at IS NULL AND failed_at IS NULL AND refunded_at IS NULL)
    OR (status = 'PAID' AND confirmed_at IS NOT NULL AND failed_at IS NULL AND refunded_at IS NULL)
    OR (status = 'FAILED' AND confirmed_at IS NULL AND failed_at IS NOT NULL AND refunded_at IS NULL)
    OR (status IN ('REFUNDED', 'PARTIALLY_REFUNDED') AND confirmed_at IS NOT NULL AND refunded_at IS NOT NULL)
    OR (status = 'DISPUTED' AND confirmed_at IS NOT NULL)
  )
);

CREATE INDEX purchases_owner_project_created_idx
  ON hive.purchases (organization_id, app_id, owner_user_id, project_id, created_at DESC);

CREATE INDEX purchases_product_created_idx
  ON hive.purchases (product_id, price_id, created_at DESC);

CREATE INDEX payments_owner_purchase_idx
  ON hive.payments (organization_id, app_id, owner_user_id, purchase_id, attempt_number DESC);

CREATE UNIQUE INDEX payments_provider_reference_unique
  ON hive.payments (provider_code, provider_payment_id)
  WHERE provider_code IS NOT NULL AND provider_payment_id IS NOT NULL;

CREATE UNIQUE INDEX payments_provider_event_unique
  ON hive.payments (provider_code, provider_event_id)
  WHERE provider_code IS NOT NULL AND provider_event_id IS NOT NULL;

CREATE FUNCTION hive.create_pending_purchase(
  target_project_id uuid,
  target_product_code text,
  target_price_id uuid,
  target_idempotency_key text
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
  selected_project hive.projects%ROWTYPE;
  selected_product hive.products%ROWTYPE;
  selected_price hive.prices%ROWTYPE;
  idempotency_hash text;
  created_purchase_id uuid;
  existing_purchase hive.purchases%ROWTYPE;
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

  IF target_product_code IS NULL
    OR target_product_code !~ '^[A-Z][A-Z0-9_]{2,127}$'
    OR target_idempotency_key IS NULL
    OR target_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
  THEN
    RAISE EXCEPTION 'INVALID_BILLING_INPUT' USING ERRCODE = 'P0001';
  END IF;

  SELECT project.*
  INTO selected_project
  FROM hive.projects AS project
  WHERE project.id = target_project_id
    AND project.organization_id = actor_organization_id
    AND project.app_id = actor_app_id
    AND project.owner_user_id = actor_user_id
    AND project.status IN ('DRAFT', 'ACTIVE')
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BILLING_ACCESS_DENIED' USING ERRCODE = 'P0001';
  END IF;

  SELECT product.*
  INTO selected_product
  FROM hive.products AS product
  WHERE product.app_id = actor_app_id
    AND product.product_code = target_product_code
    AND product.active
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT price.*
  INTO selected_price
  FROM hive.prices AS price
  WHERE price.id = target_price_id
    AND price.product_id = selected_product.id
    AND price.app_id = actor_app_id
    AND price.active
    AND price.valid_from <= now()
    AND (price.valid_until IS NULL OR price.valid_until > now())
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRICE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  idempotency_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(target_idempotency_key, 'UTF8')),
    'hex'
  );

  INSERT INTO hive.purchases (
    organization_id,
    app_id,
    project_id,
    owner_user_id,
    product_id,
    price_id,
    product_code,
    price_version,
    amount,
    currency,
    idempotency_key_sha256
  )
  VALUES (
    actor_organization_id,
    actor_app_id,
    selected_project.id,
    actor_user_id,
    selected_product.id,
    selected_price.id,
    selected_product.product_code,
    selected_price.version,
    selected_price.amount,
    selected_price.currency,
    idempotency_hash
  )
  ON CONFLICT (organization_id, app_id, owner_user_id, idempotency_key_sha256)
  DO NOTHING
  RETURNING id INTO created_purchase_id;

  IF created_purchase_id IS NULL THEN
    SELECT purchase.*
    INTO existing_purchase
    FROM hive.purchases AS purchase
    WHERE purchase.organization_id = actor_organization_id
      AND purchase.app_id = actor_app_id
      AND purchase.owner_user_id = actor_user_id
      AND purchase.idempotency_key_sha256 = idempotency_hash
    FOR UPDATE;

    IF existing_purchase.project_id <> selected_project.id
      OR existing_purchase.product_id <> selected_product.id
      OR existing_purchase.price_id <> selected_price.id
    THEN
      RAISE EXCEPTION 'BILLING_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;

    RETURN existing_purchase.id;
  END IF;

  INSERT INTO hive.payments (
    purchase_id,
    organization_id,
    app_id,
    project_id,
    owner_user_id,
    attempt_number,
    amount,
    currency
  )
  VALUES (
    created_purchase_id,
    actor_organization_id,
    actor_app_id,
    selected_project.id,
    actor_user_id,
    1,
    selected_price.amount,
    selected_price.currency
  );

  RETURN created_purchase_id;
END;
$$;

CREATE FUNCTION audit.capture_purchase_created()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM audit.append_core_event(
    'PURCHASE_CREATED',
    NEW.organization_id,
    NEW.app_id,
    NEW.project_id,
    'PURCHASE',
    NEW.id,
    jsonb_build_object(
      'product_code', NEW.product_code,
      'price_version', NEW.price_version,
      'status', NEW.status
    )
  );
  RETURN NEW;
END;
$$;

ALTER TABLE audit.events
  DROP CONSTRAINT audit_events_subject_type_check;

ALTER TABLE audit.events
  ADD CONSTRAINT audit_events_subject_type_check CHECK (
    subject_type IN (
      'AUTHENTICATION',
      'ORGANIZATION',
      'ORGANIZATION_MEMBER',
      'ORGANIZATION_APP',
      'PROJECT',
      'PURCHASE',
      'PAYMENT',
      'PLATFORM'
    )
  );

CREATE TRIGGER audit_purchases_after_insert
AFTER INSERT ON hive.purchases
FOR EACH ROW EXECUTE FUNCTION audit.capture_purchase_created();

REVOKE ALL ON hive.purchases FROM PUBLIC;
REVOKE ALL ON hive.payments FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.create_pending_purchase(uuid, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit.capture_purchase_created() FROM PUBLIC;

ALTER TABLE hive.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.purchases FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.payments FORCE ROW LEVEL SECURITY;

CREATE POLICY purchases_owner_select
  ON hive.purchases
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND organization_id = hive.current_organization_id()
    AND app_id = hive.current_app_id()
    AND owner_user_id = auth.uid()
    AND hive.has_trusted_organization_context()
    AND hive.can_access_project(project_id, app_id, organization_id)
  );

CREATE POLICY payments_owner_limited_select
  ON hive.payments
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND organization_id = hive.current_organization_id()
    AND app_id = hive.current_app_id()
    AND owner_user_id = auth.uid()
    AND hive.has_trusted_organization_context()
    AND hive.can_access_project(project_id, app_id, organization_id)
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT (
      id,
      organization_id,
      app_id,
      project_id,
      owner_user_id,
      product_id,
      price_id,
      product_code,
      price_version,
      amount,
      currency,
      status,
      confirmed_at,
      canceled_at,
      created_at,
      updated_at
    ) ON hive.purchases TO authenticated;
    GRANT SELECT (
      id,
      purchase_id,
      organization_id,
      app_id,
      project_id,
      owner_user_id,
      attempt_number,
      status,
      amount,
      currency,
      confirmed_at,
      failed_at,
      refunded_at,
      created_at,
      updated_at
    ) ON hive.payments TO authenticated;
    GRANT EXECUTE ON FUNCTION hive.create_pending_purchase(uuid, text, uuid, text)
      TO authenticated;
  END IF;
END;
$$;

COMMENT ON TABLE hive.purchases IS
  'Immutable-snapshot commercial purchase records. Billing records truth but does not grant entitlements.';
COMMENT ON COLUMN hive.purchases.idempotency_key_sha256 IS
  'SHA-256 of a bounded caller key; raw idempotency keys are not retained.';
COMMENT ON TABLE hive.payments IS
  'Server-authoritative payment attempt state. Full card numbers and CVV are prohibited.';
COMMENT ON COLUMN hive.payments.provider_payment_id IS
  'Opaque provider reference only; never payment-card data or a credential.';
