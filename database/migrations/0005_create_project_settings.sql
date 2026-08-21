-- green_hive_migration: 0005
-- checkpoint: GH-0103
-- description: Create locale and app-neutral project settings with a composite app boundary.
-- rollback_strategy: FORWARD_FIX_OR_VERIFIED_SETTINGS_RESTORE

CREATE TABLE hive.project_settings (
  project_id uuid PRIMARY KEY,
  app_id uuid NOT NULL,
  interface_language text NOT NULL DEFAULT 'pt',
  locale text NOT NULL DEFAULT 'pt-BR',
  timezone text NOT NULL DEFAULT 'UTC',
  country text,
  currency text,
  measurement_system text NOT NULL DEFAULT 'METRIC',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_settings_project_app_fk
    FOREIGN KEY (project_id, app_id)
    REFERENCES hive.projects(id, app_id)
    ON DELETE CASCADE,
  CONSTRAINT project_settings_project_app_unique UNIQUE (project_id, app_id),
  CONSTRAINT project_settings_language_format CHECK (interface_language ~ '^[a-z]{2,3}$'),
  CONSTRAINT project_settings_locale_format CHECK (
    locale ~ '^[a-z]{2,3}(-[A-Z][A-Za-z0-9]{1,7})?$'
  ),
  CONSTRAINT project_settings_timezone_present CHECK (char_length(btrim(timezone)) > 0),
  CONSTRAINT project_settings_country_format CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  CONSTRAINT project_settings_currency_format CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  CONSTRAINT project_settings_measurement_known CHECK (
    measurement_system IN ('METRIC', 'IMPERIAL')
  ),
  CONSTRAINT project_settings_settings_object CHECK (jsonb_typeof(settings) = 'object')
);

CREATE INDEX project_settings_app_idx ON hive.project_settings (app_id);
