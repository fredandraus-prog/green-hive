-- green_hive_migration: 0011
-- checkpoint: GH-0203
-- description: Create append-only tenant audit events and transactional core lifecycle capture.
-- rollback_strategy: FORWARD_FIX_OR_VERIFIED_AUDIT_EXPORT_AND_TRIGGER_DISABLE

CREATE TABLE audit.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_code text NOT NULL,
  actor_user_id uuid,
  actor_type text NOT NULL,
  organization_id uuid,
  app_id uuid,
  project_id uuid,
  subject_type text NOT NULL,
  subject_id uuid,
  outcome text NOT NULL DEFAULT 'SUCCEEDED',
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_events_event_code_check CHECK (
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
      'PAYMENT_REFUNDED',
      'ENTITLEMENT_GRANTED',
      'ENTITLEMENT_CHANGED',
      'JOB_FAILED',
      'FILE_EXPORTED',
      'ADMIN_ACCESS',
      'FEATURE_FLAG_CHANGED',
      'PROVIDER_STATUS_CHANGED'
    )
  ),
  CONSTRAINT audit_events_actor_type_check CHECK (
    actor_type IN ('USER', 'PLATFORM_ADMIN', 'SYSTEM')
  ),
  CONSTRAINT audit_events_actor_identity_check CHECK (
    (actor_type = 'SYSTEM' AND actor_user_id IS NULL)
    OR (actor_type <> 'SYSTEM' AND actor_user_id IS NOT NULL)
  ),
  CONSTRAINT audit_events_subject_type_check CHECK (
    subject_type IN (
      'AUTHENTICATION',
      'ORGANIZATION',
      'ORGANIZATION_MEMBER',
      'ORGANIZATION_APP',
      'PROJECT',
      'PLATFORM'
    )
  ),
  CONSTRAINT audit_events_outcome_check CHECK (outcome IN ('SUCCEEDED', 'DENIED', 'FAILED')),
  CONSTRAINT audit_events_metadata_object_check CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT audit_events_metadata_size_check CHECK (octet_length(metadata::text) <= 2048),
  CONSTRAINT audit_events_metadata_confidential_keys_check CHECK (
    NOT metadata ?| ARRAY[
      'authorization',
      'card',
      'content',
      'cookie',
      'document',
      'password',
      'payload',
      'prompt',
      'secret',
      'token'
    ]
  ),
  CONSTRAINT audit_events_project_scope_check CHECK (
    project_id IS NULL OR (organization_id IS NOT NULL AND app_id IS NOT NULL)
  ),
  CONSTRAINT audit_events_organization_fk
    FOREIGN KEY (organization_id)
    REFERENCES hive.organizations(id)
    ON DELETE RESTRICT,
  CONSTRAINT audit_events_app_fk
    FOREIGN KEY (app_id)
    REFERENCES hive.apps(id)
    ON DELETE RESTRICT,
  CONSTRAINT audit_events_project_scope_fk
    FOREIGN KEY (project_id, app_id, organization_id)
    REFERENCES hive.projects(id, app_id, organization_id)
    ON DELETE RESTRICT
);

CREATE INDEX audit_events_tenant_time_idx
  ON audit.events (organization_id, app_id, occurred_at DESC, id DESC);
CREATE INDEX audit_events_project_time_idx
  ON audit.events (project_id, occurred_at DESC)
  WHERE project_id IS NOT NULL;
CREATE INDEX audit_events_code_time_idx
  ON audit.events (event_code, occurred_at DESC);
CREATE INDEX audit_events_correlation_idx
  ON audit.events (correlation_id, occurred_at);

CREATE FUNCTION audit.context_uuid(setting_name text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
DECLARE
  raw_value text;
BEGIN
  raw_value := current_setting(setting_name, true);
  IF raw_value IS NULL OR btrim(raw_value) = '' THEN
    RETURN NULL;
  END IF;
  BEGIN
    RETURN raw_value::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;
END;
$$;

CREATE FUNCTION audit.append_core_event(
  target_event_code text,
  target_organization_id uuid,
  target_app_id uuid,
  target_project_id uuid,
  target_subject_type text,
  target_subject_id uuid,
  safe_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_actor_user_id uuid;
  current_actor_type text;
  current_request_id uuid;
  current_correlation_id uuid;
  inserted_event_id uuid;
BEGIN
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
    target_organization_id,
    target_app_id,
    target_project_id,
    target_subject_type,
    target_subject_id,
    'SUCCEEDED',
    current_request_id,
    current_correlation_id,
    safe_metadata
  )
  RETURNING id INTO inserted_event_id;

  RETURN inserted_event_id;
END;
$$;

CREATE FUNCTION audit.capture_organization_created()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM audit.append_core_event(
    'ORGANIZATION_CREATED',
    NEW.id,
    hive.current_app_id(),
    NULL,
    'ORGANIZATION',
    NEW.id,
    jsonb_build_object('kind', NEW.kind)
  );
  RETURN NEW;
END;
$$;

CREATE FUNCTION audit.capture_organization_member_change()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_event_code text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.role = NEW.role AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  target_event_code := CASE
    WHEN TG_OP = 'INSERT' THEN 'ORGANIZATION_MEMBER_ADDED'
    ELSE 'ORGANIZATION_MEMBER_CHANGED'
  END;
  PERFORM audit.append_core_event(
    target_event_code,
    NEW.organization_id,
    hive.current_app_id(),
    NULL,
    'ORGANIZATION_MEMBER',
    NEW.user_id,
    jsonb_build_object('role', NEW.role, 'status', NEW.status)
  );
  RETURN NEW;
END;
$$;

CREATE FUNCTION audit.capture_organization_app_installed()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM audit.append_core_event(
    'ORGANIZATION_APP_INSTALLED',
    NEW.organization_id,
    NEW.app_id,
    NULL,
    'ORGANIZATION_APP',
    NEW.app_id,
    jsonb_build_object('relationship', NEW.relationship)
  );
  RETURN NEW;
END;
$$;

CREATE FUNCTION audit.capture_project_lifecycle()
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
    target_event_code := 'PROJECT_CREATED';
  ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'ARCHIVED' THEN
    target_event_code := 'PROJECT_ARCHIVED';
  ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'DELETED' THEN
    target_event_code := 'PROJECT_DELETION_REQUESTED';
  ELSE
    RETURN NEW;
  END IF;

  PERFORM audit.append_core_event(
    target_event_code,
    NEW.organization_id,
    NEW.app_id,
    NEW.id,
    'PROJECT',
    NEW.id,
    jsonb_build_object('status', NEW.status)
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_organizations_after_insert
AFTER INSERT ON hive.organizations
FOR EACH ROW EXECUTE FUNCTION audit.capture_organization_created();

CREATE TRIGGER audit_organization_members_after_change
AFTER INSERT OR UPDATE ON hive.organization_members
FOR EACH ROW EXECUTE FUNCTION audit.capture_organization_member_change();

CREATE TRIGGER audit_organization_apps_after_insert
AFTER INSERT ON hive.organization_apps
FOR EACH ROW EXECUTE FUNCTION audit.capture_organization_app_installed();

CREATE TRIGGER audit_projects_after_lifecycle
AFTER INSERT OR UPDATE ON hive.projects
FOR EACH ROW EXECUTE FUNCTION audit.capture_project_lifecycle();

REVOKE ALL ON ALL TABLES IN SCHEMA audit FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA audit FROM PUBLIC;

ALTER TABLE audit.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.events FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_events_tenant_or_platform_select
  ON audit.events
  FOR SELECT
  USING (
    hive.is_platform_admin()
    OR (
      organization_id = hive.current_organization_id()
      AND app_id = hive.current_app_id()
      AND hive.has_trusted_organization_context()
    )
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT USAGE ON SCHEMA audit TO authenticated;
    GRANT SELECT ON audit.events TO authenticated;
  END IF;
END;
$$;

COMMENT ON TABLE audit.events IS
  'Append-only operational accountability events. Confidential business payloads are prohibited.';
COMMENT ON COLUMN audit.events.metadata IS
  'Bounded allowlisted operational metadata only; never prompts, documents, credentials or raw payloads.';
