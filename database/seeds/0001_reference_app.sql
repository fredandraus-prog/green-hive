INSERT INTO hive.apps (
  id,
  app_code,
  name,
  app_version,
  status,
  schema_namespace,
  manifest,
  metadata
)
VALUES (
  '00000000-0000-4000-8000-000000000001'::uuid,
  'REFERENCE_APP',
  'Green Hive Reference App',
  '0.1.0',
  'INTERNAL',
  'reference_app',
  '{
    "schemaVersion": 1,
    "appCode": "REFERENCE_APP",
    "appName": "Green Hive Reference App",
    "appVersion": "0.1.0",
    "status": "INTERNAL",
    "projectNamespace": "reference",
    "supportedLocales": ["pt-BR", "en-US"],
    "defaultLocale": "pt-BR",
    "requiredCapabilities": ["AUTH", "PROJECTS", "ENTITLEMENTS", "COST_GUARD", "JOBS", "AI", "FILES", "AUDIT", "I18N", "FEATURE_FLAGS"],
    "products": [{"productCode": "REFERENCE_APP_SANDBOX", "productType": "ONE_TIME"}],
    "entitlementCapabilities": ["REFERENCE_APP_RUN_JOB", "REFERENCE_APP_GENERATE_FILE"],
    "jobTypes": ["REFERENCE_APP_FAKE_AI_JOB"],
    "aiTaskTypes": ["REFERENCE_APP_STRUCTURED_ECHO"],
    "featureFlags": ["REFERENCE_APP_GOLDEN_FLOW"],
    "routes": [
      {"routeCode": "REFERENCE_APP_HOME", "path": "/reference"},
      {"routeCode": "REFERENCE_APP_PROJECT", "path": "/reference/projects/:projectId"}
    ]
  }'::jsonb,
  '{"seed":"structural","owner":"green-hive"}'::jsonb
)
ON CONFLICT (app_code) DO UPDATE
SET
  name = EXCLUDED.name,
  app_version = EXCLUDED.app_version,
  status = EXCLUDED.status,
  manifest = EXCLUDED.manifest,
  metadata = EXCLUDED.metadata,
  updated_at = now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM hive.apps
    WHERE app_code = 'REFERENCE_APP'
      AND id = '00000000-0000-4000-8000-000000000001'::uuid
      AND schema_namespace = 'reference_app'
  ) THEN
    RAISE EXCEPTION 'REFERENCE_APP seed conflicts with an existing registry identity';
  END IF;
END;
$$;
