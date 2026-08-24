# Trusted app and organization context

## Signed authority chain

Green Hive accepts identity and app authority only from Supabase-authenticated JWT claims:

```json
{
  "sub": "user-uuid",
  "app_metadata": {
    "app_code": "REFERENCE_APP",
    "platform_role": "USER"
  }
}
```

- `auth.uid()` supplies the user UUID.
- `auth.jwt() -> 'app_metadata' ->> 'app_code'` supplies the stable app code.
- `app_metadata.platform_role = PLATFORM_ADMIN` supplies the only platform role in this slice.
- `user_metadata`, top-level lookalike claims and request fields are ignored for authorization.

Supabase token issuance must keep `app_metadata` server-controlled. Because JWT claims can remain
stale until token refresh, changing app or platform role metadata requires a refreshed session.

## SQL helpers

- `hive.current_app_code()` reads the signed app code.
- `hive.current_app_id()` resolves an enabled registry row without exposing the registry.
- `hive.is_platform_admin()` identifies the read-only admin role.
- `hive.has_trusted_app_context()` requires both user and registered app.
- `hive.requested_organization_id()` reads only the server transaction's requested UUID.
- `hive.current_organization_id()` promotes that UUID only when `auth.uid()` has an active
  membership in an active organization.
- `hive.has_trusted_organization_context()` additionally requires an active app installation.
- `hive.ensure_personal_organization(text)` provisions the user's single personal workspace.
- `hive.create_shared_organization(text)` creates a shared workspace with the caller as owner.
- `hive.soft_delete_project(uuid)` performs the controlled logical-deletion transition.
- `hive.configure_usage_budget(...)`, `hive.record_usage_event(...)` and
  `hive.record_cost_event(...)` repeat the same signed user/app/workspace/project authority behind
  a server-only execution grant.

All security-definer helpers use a fixed empty `search_path` and fully qualified object names.
Functions and tables revoke `PUBLIC`; only required calls are granted to `authenticated`.
The GH-0401 accounting writers are not required client calls and remain executable only by the
trusted server role when present.

## App and owner isolation

Supplying another `organization_id`, `app_id` or `owner_user_id` in a row cannot change the trusted
context. A browser workspace cookie is a preference, not authority: the server validates active
membership in the same database transaction before adding `organizationId` to
`TrustedOrganizationContext`. A project is writable only when organization, installed app and
owner match the trusted transaction.

`PLATFORM_ADMIN` retains read-only access to app and organization operational metadata. Migration
`0010` removes its legacy profile/project/settings policies, so the role no longer receives
automatic private-content access. A future audited break-glass design is tracked in the Ideas
Radar and is not emulated here.
