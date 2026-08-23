-- green_hive_migration: 0012
-- checkpoint: GH-0301
-- description: Create app-scoped products and immutable versioned price catalog tables.
-- rollback_strategy: FORWARD_FIX_OR_VERIFIED_CATALOG_EXPORT_RESTORE

CREATE TABLE hive.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL,
  product_code text NOT NULL,
  product_type text NOT NULL,
  name text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_app_fk
    FOREIGN KEY (app_id) REFERENCES hive.apps(id) ON DELETE RESTRICT,
  CONSTRAINT products_app_code_unique UNIQUE (app_id, product_code),
  CONSTRAINT products_id_app_unique UNIQUE (id, app_id),
  CONSTRAINT products_code_check CHECK (product_code ~ '^[A-Z][A-Z0-9_]{2,127}$'),
  CONSTRAINT products_type_check CHECK (
    product_type IN ('ONE_TIME', 'REANALYSIS_OR_REPROCESS', 'SUBSCRIPTION', 'INTERNAL_GRANT')
  ),
  CONSTRAINT products_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  CONSTRAINT products_description_check CHECK (
    description IS NULL OR char_length(description) <= 2000
  ),
  CONSTRAINT products_metadata_object_check CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE TABLE hive.prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  app_id uuid NOT NULL,
  version integer NOT NULL,
  currency text NOT NULL,
  amount numeric(20, 6) NOT NULL,
  locale text,
  active boolean NOT NULL DEFAULT true,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prices_product_app_fk
    FOREIGN KEY (product_id, app_id)
    REFERENCES hive.products(id, app_id)
    ON DELETE RESTRICT,
  CONSTRAINT prices_id_product_app_unique UNIQUE (id, product_id, app_id),
  CONSTRAINT prices_version_check CHECK (version > 0),
  CONSTRAINT prices_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT prices_amount_check CHECK (amount >= 0),
  CONSTRAINT prices_locale_check CHECK (
    locale IS NULL OR locale ~ '^[a-z]{2,3}(-[A-Z][A-Za-z0-9]{1,7})?$'
  ),
  CONSTRAINT prices_valid_window_check CHECK (
    valid_until IS NULL OR valid_until > valid_from
  ),
  CONSTRAINT prices_metadata_object_check CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX prices_product_currency_locale_version_unique
  ON hive.prices (product_id, currency, COALESCE(locale, ''), version);

CREATE INDEX products_app_active_code_idx
  ON hive.products (app_id, active, product_code);

CREATE INDEX prices_active_catalog_idx
  ON hive.prices (app_id, product_id, active, valid_from, valid_until);

REVOKE ALL ON hive.products FROM PUBLIC;
REVOKE ALL ON hive.prices FROM PUBLIC;

ALTER TABLE hive.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.products FORCE ROW LEVEL SECURITY;
ALTER TABLE hive.prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive.prices FORCE ROW LEVEL SECURITY;

CREATE POLICY products_catalog_select
  ON hive.products
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

CREATE POLICY prices_catalog_select
  ON hive.prices
  FOR SELECT
  TO authenticated
  USING (
    hive.is_platform_admin()
    OR (
      active
      AND valid_from <= now()
      AND (valid_until IS NULL OR valid_until > now())
      AND app_id = hive.current_app_id()
      AND hive.has_trusted_organization_context()
      AND EXISTS (
        SELECT 1
        FROM hive.products AS product
        WHERE product.id = prices.product_id
          AND product.app_id = prices.app_id
          AND product.active
      )
    )
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT ON hive.products TO authenticated;
    GRANT SELECT ON hive.prices TO authenticated;
  END IF;
END;
$$;

COMMENT ON TABLE hive.products IS
  'App-scoped generic product catalog. Product codes originate from the App Manifest.';
COMMENT ON TABLE hive.prices IS
  'Immutable-version price catalog. Monetary values use PostgreSQL numeric, never floating point.';
COMMENT ON COLUMN hive.prices.amount IS
  'Exact decimal commercial value; consumers must preserve it as a decimal string.';
