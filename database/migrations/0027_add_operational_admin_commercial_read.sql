-- green_hive_migration: 0027
-- checkpoint: GH-0801
-- description: Create a platform-admin-only aggregate overview without exposing account, project or commercial rows.
-- rollback_strategy: FORWARD_FIX_OR_REVIEWED_OPERATIONAL_AGGREGATE_EXPORT_RESTORE
-- The dashboard receives one bounded JSON document. It never receives account, project, payment or provider-reference rows.

CREATE FUNCTION hive.operational_admin_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  overview jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT hive.is_platform_admin() THEN
    RAISE EXCEPTION 'platform administrator access is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'users', (SELECT count(*) FROM hive.user_profiles),
    'workspaces', (SELECT count(*) FROM hive.organizations),
    'projects', jsonb_build_object(
      'DRAFT', (SELECT count(*) FROM hive.projects WHERE status = 'DRAFT'),
      'ACTIVE', (SELECT count(*) FROM hive.projects WHERE status = 'ACTIVE'),
      'ARCHIVED', (SELECT count(*) FROM hive.projects WHERE status = 'ARCHIVED'),
      'DELETED', (SELECT count(*) FROM hive.projects WHERE status = 'DELETED')
    ),
    'purchases', COALESCE((
      SELECT jsonb_object_agg(status, total)
      FROM (SELECT status, count(*) AS total FROM hive.purchases GROUP BY status) AS purchase_counts
    ), '{}'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_object_agg(status, total)
      FROM (SELECT status, count(*) AS total FROM hive.payments GROUP BY status) AS payment_counts
    ), '{}'::jsonb),
    'jobs', COALESCE((
      SELECT jsonb_object_agg(status, total)
      FROM (SELECT status, count(*) AS total FROM hive.jobs GROUP BY status) AS job_counts
    ), '{}'::jsonb),
    'budgets', COALESCE((
      SELECT jsonb_object_agg(status, total)
      FROM (SELECT status, count(*) AS total FROM hive.usage_budgets GROUP BY status) AS budget_counts
    ), '{}'::jsonb),
    'costs', COALESCE((
      SELECT jsonb_object_agg(currency, total)
      FROM (SELECT currency, count(*) AS total FROM hive.cost_events GROUP BY currency) AS cost_counts
    ), '{}'::jsonb),
    'providerOperations', COALESCE((
      SELECT jsonb_object_agg(provider_code, total)
      FROM (
        SELECT provider_code, count(*) AS total
        FROM (
          SELECT provider_code FROM hive.ai_operations
          UNION ALL
          SELECT provider_code FROM hive.search_operations
        ) AS operations
        GROUP BY provider_code
      ) AS provider_counts
    ), '{}'::jsonb)
  ) INTO overview;

  RETURN overview;
END;
$$;

REVOKE ALL ON FUNCTION hive.operational_admin_overview() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION hive.operational_admin_overview() TO authenticated;
  END IF;
END;
$$;

COMMENT ON FUNCTION hive.operational_admin_overview() IS
  'GH-0801 trusted aggregate-only operational read model. It returns no tenant rows or provider references.';
