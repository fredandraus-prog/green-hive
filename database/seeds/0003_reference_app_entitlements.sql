DO $$
DECLARE
  reference_app_id constant uuid := '00000000-0000-4000-8000-000000000001'::uuid;
  reference_product_id constant uuid := '40000000-0000-4000-8000-000000000001'::uuid;
  registered_app hive.apps%ROWTYPE;
  registered_product hive.products%ROWTYPE;
  target_purchase record;
BEGIN
  SELECT app.*
  INTO registered_app
  FROM hive.apps AS app
  WHERE app.app_code = 'REFERENCE_APP';

  IF NOT FOUND OR registered_app.id <> reference_app_id THEN
    RAISE EXCEPTION 'REFERENCE_APP entitlement seed requires the canonical app identity';
  END IF;

  SELECT product.*
  INTO registered_product
  FROM hive.products AS product
  WHERE product.id = reference_product_id;

  IF NOT FOUND
    OR registered_product.app_id <> reference_app_id
    OR registered_product.product_code <> 'REFERENCE_APP_SANDBOX'
  THEN
    RAISE EXCEPTION 'REFERENCE_APP entitlement seed requires the canonical product identity';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(
      registered_app.manifest -> 'entitlementCapabilities'
    ) AS declared(capability_code)
    WHERE declared.capability_code = 'REFERENCE_APP_RUN_JOB'
  ) OR NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(
      registered_app.manifest -> 'entitlementCapabilities'
    ) AS declared(capability_code)
    WHERE declared.capability_code = 'REFERENCE_APP_GENERATE_FILE'
  ) THEN
    RAISE EXCEPTION 'REFERENCE_APP entitlement seed differs from the canonical App Manifest';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM hive.product_entitlement_capabilities AS mapping
    WHERE mapping.product_id = reference_product_id
      AND mapping.capability_code NOT IN (
        'REFERENCE_APP_RUN_JOB',
        'REFERENCE_APP_GENERATE_FILE'
      )
  ) THEN
    RAISE EXCEPTION 'REFERENCE_APP entitlement seed conflicts with an unexpected product capability';
  END IF;

  INSERT INTO hive.product_entitlement_capabilities (
    product_id,
    app_id,
    capability_code,
    active
  )
  VALUES
    (
      reference_product_id,
      reference_app_id,
      'REFERENCE_APP_RUN_JOB',
      true
    ),
    (
      reference_product_id,
      reference_app_id,
      'REFERENCE_APP_GENERATE_FILE',
      true
    )
  ON CONFLICT (product_id, capability_code)
  DO UPDATE
  SET
    active = EXCLUDED.active,
    updated_at = now();

  FOR target_purchase IN
    SELECT purchase.id
    FROM hive.purchases AS purchase
    WHERE purchase.product_id = reference_product_id
  LOOP
    PERFORM hive.apply_entitlement_state_for_purchase(target_purchase.id);
  END LOOP;
END;
$$;
