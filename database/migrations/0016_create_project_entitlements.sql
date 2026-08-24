-- green_hive_migration: 0016
-- checkpoint: GH-0304
-- description: Create product capability mappings, project entitlement grants and the server-authoritative can service.
-- rollback_strategy: FORWARD_FIX_OR_VERIFIED_ENTITLEMENT_EXPORT_RESTORE

ALTER TABLE hive.purchases
  ADD CONSTRAINT purchases_entitlement_source_unique
  UNIQUE (
    id,
    organization_id,
    app_id,
    project_id,
    owner_user_id,
    product_id,
    product_code,
    price_version
  );

CREATE TABLE hive.product_entitlement_capabilities (
  product_id uuid NOT NULL,
  app_id uuid NOT NULL,
  capability_code text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_entitlement_capabilities_pk
    PRIMARY KEY (product_id, capability_code),
  CONSTRAINT product_entitlement_capabilities_product_app_fk
    FOREIGN KEY (product_id, app_id)
    REFERENCES hive.products(id, app_id)
    ON DELETE RESTRICT,
  CONSTRAINT product_entitlement_capabilities_code_check CHECK (
    capability_code ~ '^[A-Z][A-Z0-9_]{2,127}$'
  )
);

CREATE TABLE hive.project_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  app_id uuid NOT NULL,
  project_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  product_id uuid NOT NULL,
  purchase_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  product_code text NOT NULL,
  price_version integer NOT NULL,
  capability_code text NOT NULL,
  source_type text NOT NULL DEFAULT 'PURCHASE',
  status text NOT NULL,
  granted_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_entitlements_project_scope_fk
    FOREIGN KEY (project_id, app_id, organization_id, owner_user_id)
    REFERENCES hive.projects(id, app_id, organization_id, owner_user_id)
    ON DELETE RESTRICT,
  CONSTRAINT project_entitlements_purchase_source_fk
    FOREIGN KEY (
      purchase_id,
      organization_id,
      app_id,
      project_id,
      owner_user_id,
      product_id,
      product_code,
      price_version
    )
    REFERENCES hive.purchases(
      id,
      organization_id,
      app_id,
      project_id,
      owner_user_id,
      product_id,
      product_code,
      price_version
    )
    ON DELETE RESTRICT,
  CONSTRAINT project_entitlements_payment_purchase_fk
    FOREIGN KEY (payment_id, purchase_id)
    REFERENCES hive.payments(id, purchase_id)
    ON DELETE RESTRICT,
  CONSTRAINT project_entitlements_product_capability_fk
    FOREIGN KEY (product_id, capability_code)
    REFERENCES hive.product_entitlement_capabilities(product_id, capability_code)
    ON DELETE RESTRICT,
  CONSTRAINT project_entitlements_purchase_capability_unique
    UNIQUE (purchase_id, capability_code),
  CONSTRAINT project_entitlements_id_scope_unique
    UNIQUE (id, organization_id, app_id, project_id, owner_user_id),
  CONSTRAINT project_entitlements_product_code_check CHECK (
    product_code ~ '^[A-Z][A-Z0-9_]{2,127}$'
  ),
  CONSTRAINT project_entitlements_price_version_check CHECK (price_version > 0),
  CONSTRAINT project_entitlements_capability_code_check CHECK (
    capability_code ~ '^[A-Z][A-Z0-9_]{2,127}$'
  ),
  CONSTRAINT project_entitlements_source_type_check CHECK (source_type = 'PURCHASE'),
  CONSTRAINT project_entitlements_status_check CHECK (status IN ('ACTIVE', 'REVOKED')),
  CONSTRAINT project_entitlements_lifecycle_check CHECK (
    (status = 'ACTIVE' AND revoked_at IS NULL)
    OR (status = 'REVOKED' AND revoked_at IS NOT NULL AND revoked_at >= granted_at)
  )
);

CREATE INDEX product_entitlement_capabilities_app_active_idx
  ON hive.product_entitlement_capabilities (app_id, active, capability_code);

CREATE INDEX project_entitlements_owner_project_status_idx
  ON hive.project_entitlements (
    organization_id,
    app_id,
    owner_user_id,
    project_id,
    status,
    capability_code
  );

CREATE INDEX project_entitlements_product_status_idx
  ON hive.project_entitlements (product_id, status, capability_code);

CREATE FUNCTION hive.apply_entitlement_state_for_purchase(target_purchase_id uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  selected_purchase hive.purchases%ROWTYPE;
  selected_payment hive.payments%ROWTYPE;
  transition_time timestamptz;
  changed_rows integer := 0;
BEGIN
  SELECT purchase.*
  INTO selected_purchase
  FROM hive.purchases AS purchase
  WHERE purchase.id = target_purchase_id
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  SELECT payment.*
  INTO selected_payment
  FROM hive.payments AS payment
  WHERE payment.purchase_id = selected_purchase.id
  ORDER BY payment.attempt_number DESC
  LIMIT 1
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  IF selected_purchase.status = 'CONFIRMED' AND selected_payment.status = 'PAID' THEN
    transition_time := COALESCE(selected_payment.confirmed_at, statement_timestamp());

    INSERT INTO hive.project_entitlements (
      organization_id,
      app_id,
      project_id,
      owner_user_id,
      product_id,
      purchase_id,
      payment_id,
      product_code,
      price_version,
      capability_code,
      source_type,
      status,
      granted_at,
      revoked_at
    )
    SELECT
      selected_purchase.organization_id,
      selected_purchase.app_id,
      selected_purchase.project_id,
      selected_purchase.owner_user_id,
      selected_purchase.product_id,
      selected_purchase.id,
      selected_payment.id,
      selected_purchase.product_code,
      selected_purchase.price_version,
      mapping.capability_code,
      'PURCHASE',
      'ACTIVE',
      transition_time,
      NULL
    FROM hive.product_entitlement_capabilities AS mapping
    JOIN hive.apps AS app
      ON app.id = mapping.app_id
    WHERE mapping.product_id = selected_purchase.product_id
      AND mapping.app_id = selected_purchase.app_id
      AND mapping.active
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements_text(
          COALESCE(app.manifest -> 'entitlementCapabilities', '[]'::jsonb)
        ) AS declared(capability_code)
        WHERE declared.capability_code = mapping.capability_code
      )
    ON CONFLICT (purchase_id, capability_code)
    DO UPDATE
    SET
      payment_id = EXCLUDED.payment_id,
      status = 'ACTIVE',
      granted_at = CASE
        WHEN hive.project_entitlements.status = 'ACTIVE'
          THEN hive.project_entitlements.granted_at
        ELSE EXCLUDED.granted_at
      END,
      revoked_at = NULL,
      updated_at = statement_timestamp()
    WHERE hive.project_entitlements.status <> 'ACTIVE'
       OR hive.project_entitlements.payment_id <> EXCLUDED.payment_id;

    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    RETURN changed_rows;
  END IF;

  IF selected_purchase.status = 'CONFIRMED' AND selected_payment.status = 'REFUNDED' THEN
    transition_time := COALESCE(selected_payment.refunded_at, statement_timestamp());

    INSERT INTO hive.project_entitlements (
      organization_id,
      app_id,
      project_id,
      owner_user_id,
      product_id,
      purchase_id,
      payment_id,
      product_code,
      price_version,
      capability_code,
      source_type,
      status,
      granted_at,
      revoked_at
    )
    SELECT
      selected_purchase.organization_id,
      selected_purchase.app_id,
      selected_purchase.project_id,
      selected_purchase.owner_user_id,
      selected_purchase.product_id,
      selected_purchase.id,
      selected_payment.id,
      selected_purchase.product_code,
      selected_purchase.price_version,
      mapping.capability_code,
      'PURCHASE',
      'REVOKED',
      COALESCE(selected_payment.confirmed_at, transition_time),
      transition_time
    FROM hive.product_entitlement_capabilities AS mapping
    JOIN hive.apps AS app
      ON app.id = mapping.app_id
    WHERE mapping.product_id = selected_purchase.product_id
      AND mapping.app_id = selected_purchase.app_id
      AND mapping.active
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements_text(
          COALESCE(app.manifest -> 'entitlementCapabilities', '[]'::jsonb)
        ) AS declared(capability_code)
        WHERE declared.capability_code = mapping.capability_code
      )
    ON CONFLICT (purchase_id, capability_code)
    DO UPDATE
    SET
      payment_id = EXCLUDED.payment_id,
      status = 'REVOKED',
      revoked_at = EXCLUDED.revoked_at,
      updated_at = statement_timestamp()
    WHERE hive.project_entitlements.status <> 'REVOKED'
       OR hive.project_entitlements.payment_id <> EXCLUDED.payment_id
       OR hive.project_entitlements.revoked_at IS DISTINCT FROM EXCLUDED.revoked_at;

    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    RETURN changed_rows;
  END IF;

  RETURN 0;
END;
$$;

CREATE FUNCTION hive.sync_entitlements_after_billing_transition()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_purchase_id uuid;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF TG_TABLE_NAME = 'payments' THEN
      target_purchase_id := (to_jsonb(NEW) ->> 'purchase_id')::uuid;
    ELSE
      target_purchase_id := (to_jsonb(NEW) ->> 'id')::uuid;
    END IF;

    PERFORM hive.apply_entitlement_state_for_purchase(target_purchase_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION hive.can_project_capability(
  target_project_id uuid,
  target_capability_code text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND NOT hive.is_platform_admin()
    AND hive.current_app_id() IS NOT NULL
    AND hive.current_organization_id() IS NOT NULL
    AND hive.has_trusted_organization_context()
    AND target_capability_code IS NOT NULL
    AND target_capability_code ~ '^[A-Z][A-Z0-9_]{2,127}$'
    AND EXISTS (
      SELECT 1
      FROM hive.projects AS project
      JOIN hive.project_entitlements AS entitlement
        ON entitlement.project_id = project.id
       AND entitlement.app_id = project.app_id
       AND entitlement.organization_id = project.organization_id
       AND entitlement.owner_user_id = project.owner_user_id
      JOIN hive.product_entitlement_capabilities AS mapping
        ON mapping.product_id = entitlement.product_id
       AND mapping.capability_code = entitlement.capability_code
       AND mapping.app_id = entitlement.app_id
      JOIN hive.apps AS app
        ON app.id = entitlement.app_id
      WHERE project.id = target_project_id
        AND project.owner_user_id = auth.uid()
        AND project.app_id = hive.current_app_id()
        AND project.organization_id = hive.current_organization_id()
        AND project.status IN ('DRAFT', 'ACTIVE')
        AND entitlement.status = 'ACTIVE'
        AND entitlement.capability_code = target_capability_code
        AND mapping.active
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.jsonb_array_elements_text(
            COALESCE(app.manifest -> 'entitlementCapabilities', '[]'::jsonb)
          ) AS declared(capability_code)
          WHERE declared.capability_code = target_capability_code
        )
    );
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
      'ENTITLEMENT',
      'PLATFORM'
    )
  );

CREATE FUNCTION audit.capture_entitlement_transition()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_event_code text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    target_event_code := CASE
      WHEN NEW.status = 'ACTIVE' THEN 'ENTITLEMENT_GRANTED'
      ELSE 'ENTITLEMENT_CHANGED'
    END;
  ELSIF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  ELSE
    target_event_code := CASE
      WHEN NEW.status = 'ACTIVE' THEN 'ENTITLEMENT_GRANTED'
      ELSE 'ENTITLEMENT_CHANGED'
    END;
  END IF;

  PERFORM audit.append_core_event(
    target_event_code,
    NEW.organization_id,
    NEW.app_id,
    NEW.project_id,
    'ENTITLEMENT',
    NEW.id,
    jsonb_build_object(
      'capability_code', NEW.capability_code,
      'product_code', NEW.product_code,
      'price_version', NEW.price_version,
      'source_type', NEW.source_type,
      'status', NEW.status
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER entitlements_purchases_after_transition
AFTER UPDATE OF status ON hive.purchases
FOR EACH ROW EXECUTE FUNCTION hive.sync_entitlements_after_billing_transition();

CREATE TRIGGER entitlements_payments_after_transition
AFTER UPDATE OF status ON hive.payments
FOR EACH ROW EXECUTE FUNCTION hive.sync_entitlements_after_billing_transition();

CREATE TRIGGER audit_project_entitlements_after_transition
AFTER INSERT OR UPDATE OF status ON hive.project_entitlements
FOR EACH ROW EXECUTE FUNCTION audit.capture_entitlement_transition();

REVOKE ALL ON hive.product_entitlement_capabilities FROM PUBLIC;
REVOKE ALL ON hive.project_entitlements FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.apply_entitlement_state_for_purchase(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.sync_entitlements_after_billing_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION hive.can_project_capability(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit.capture_entitlement_transition() FROM PUBLIC;

ALTER TABLE hive.product_entitlement_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.product_entitlement_capabilities FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.project_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.project_entitlements FORCE ROW LEVEL SECURITY;

CREATE POLICY product_entitlement_capabilities_catalog_select
  ON hive.product_entitlement_capabilities
  FOR SELECT
  TO authenticated
  USING (
    hive.is_platform_admin()
    OR (
      active
      AND app_id = hive.current_app_id()
      AND hive.has_trusted_organization_context()
    )
  );

CREATE POLICY project_entitlements_owner_or_platform_select
  ON hive.project_entitlements
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
    GRANT SELECT ON hive.product_entitlement_capabilities TO authenticated;
    GRANT SELECT (
      id,
      organization_id,
      app_id,
      project_id,
      owner_user_id,
      product_id,
      purchase_id,
      payment_id,
      product_code,
      price_version,
      capability_code,
      source_type,
      status,
      granted_at,
      revoked_at,
      created_at,
      updated_at
    ) ON hive.project_entitlements TO authenticated;
    GRANT EXECUTE ON FUNCTION hive.can_project_capability(uuid, text) TO authenticated;
    REVOKE ALL ON FUNCTION hive.apply_entitlement_state_for_purchase(uuid) FROM authenticated;
    REVOKE ALL ON FUNCTION hive.sync_entitlements_after_billing_transition() FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION hive.apply_entitlement_state_for_purchase(uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION hive.can_project_capability(uuid, text) TO service_role;
  END IF;
END;
$$;

COMMENT ON TABLE hive.product_entitlement_capabilities IS
  'Reviewed product-to-capability mapping. Capability codes originate from the App Manifest.';
COMMENT ON TABLE hive.project_entitlements IS
  'Project capability grants derived from immutable purchase snapshots and authoritative payment state.';
COMMENT ON FUNCTION hive.apply_entitlement_state_for_purchase(uuid) IS
  'Internal Billing-to-Entitlements transaction boundary. Not executable by authenticated clients.';
COMMENT ON FUNCTION hive.can_project_capability(uuid, text) IS
  'Server-authoritative project capability decision scoped to verified user, app and organization context.';
