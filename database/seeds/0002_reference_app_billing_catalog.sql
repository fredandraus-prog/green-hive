DO $$
DECLARE
  reference_app_id constant uuid := '00000000-0000-4000-8000-000000000001'::uuid;
  reference_product_id constant uuid := '40000000-0000-4000-8000-000000000001'::uuid;
  reference_price_id constant uuid := '50000000-0000-4000-8000-000000000001'::uuid;
  registered_app hive.apps%ROWTYPE;
  conflicting_product hive.products%ROWTYPE;
  conflicting_price hive.prices%ROWTYPE;
BEGIN
  SELECT app.*
  INTO registered_app
  FROM hive.apps AS app
  WHERE app.app_code = 'REFERENCE_APP';

  IF NOT FOUND OR registered_app.id <> reference_app_id THEN
    RAISE EXCEPTION 'REFERENCE_APP billing seed requires the canonical app identity';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(registered_app.manifest -> 'products') AS product
    WHERE product ->> 'productCode' = 'REFERENCE_APP_SANDBOX'
      AND product ->> 'productType' = 'ONE_TIME'
  ) THEN
    RAISE EXCEPTION 'REFERENCE_APP billing seed differs from the canonical App Manifest';
  END IF;

  SELECT product.*
  INTO conflicting_product
  FROM hive.products AS product
  WHERE product.id = reference_product_id
     OR (product.app_id = reference_app_id AND product.product_code = 'REFERENCE_APP_SANDBOX')
  LIMIT 1;

  IF FOUND AND (
    conflicting_product.id <> reference_product_id
    OR conflicting_product.app_id <> reference_app_id
    OR conflicting_product.product_code <> 'REFERENCE_APP_SANDBOX'
  ) THEN
    RAISE EXCEPTION 'REFERENCE_APP billing product seed conflicts with an immutable identity';
  END IF;

  INSERT INTO hive.products (
    id,
    app_id,
    product_code,
    product_type,
    name,
    description,
    active,
    metadata
  )
  VALUES (
    reference_product_id,
    reference_app_id,
    'REFERENCE_APP_SANDBOX',
    'ONE_TIME',
    'Reference App Sandbox',
    'Internal zero-value catalog item used only for the Green Hive sandbox flow.',
    true,
    '{"seed":"REFERENCE_APP","commercial_use":false}'::jsonb
  )
  ON CONFLICT (id) DO UPDATE
  SET
    product_type = EXCLUDED.product_type,
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    active = EXCLUDED.active,
    metadata = EXCLUDED.metadata,
    updated_at = now();

  SELECT price.*
  INTO conflicting_price
  FROM hive.prices AS price
  WHERE price.id = reference_price_id
     OR (
       price.product_id = reference_product_id
       AND price.currency = 'BRL'
       AND COALESCE(price.locale, '') = 'pt-BR'
       AND price.version = 1
     )
  LIMIT 1;

  IF FOUND AND (
    conflicting_price.id <> reference_price_id
    OR conflicting_price.product_id <> reference_product_id
    OR conflicting_price.app_id <> reference_app_id
  ) THEN
    RAISE EXCEPTION 'REFERENCE_APP billing price seed conflicts with an immutable identity';
  END IF;

  INSERT INTO hive.prices (
    id,
    product_id,
    app_id,
    version,
    currency,
    amount,
    locale,
    active,
    valid_from,
    metadata
  )
  VALUES (
    reference_price_id,
    reference_product_id,
    reference_app_id,
    1,
    'BRL',
    0.000000,
    'pt-BR',
    true,
    '2026-01-01T00:00:00Z'::timestamptz,
    '{"seed":"REFERENCE_APP","sandbox":true,"commercial_use":false}'::jsonb
  )
  ON CONFLICT (id) DO UPDATE
  SET
    amount = EXCLUDED.amount,
    active = EXCLUDED.active,
    metadata = EXCLUDED.metadata,
    updated_at = now();
END;
$$;
