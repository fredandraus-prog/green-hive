# GH-0250 Workspace Service

`WorkspaceService` lives in the existing `@green-hive/projects` package so the canonical platform
still has 18 packages. It owns the organization boundary around app-neutral projects; it does not
implement Billing, portfolio analytics or consumer-domain collaboration.

## Public surface

```text
ensurePersonal(context) -> Workspace
list(context) -> Workspace[]
createShared(context, input) -> Workspace
listMembers(organizationContext) -> WorkspaceMember[]
addMember(organizationContext, input) -> WorkspaceMember
```

Workspace roles are `OWNER`, `ADMIN`, `DEVELOPER`, `ANALYST` and `VIEWER`. The initial membership
command intentionally cannot assign a second `OWNER`; ownership transfer requires a future audited
workflow. Repeating an allowed member assignment activates and synchronizes that bounded role.

## Authority

Personal and shared creation functions derive the caller from `auth.uid()` and the installed app
from signed `app_metadata.app_code`. The browser cannot provide an owner or app. A supplied
workspace UUID is accepted by project/member commands only after
`PostgresAuthenticatedSessionRunner.runInOrganization` verifies active membership through
`hive.current_organization_id()` inside the transaction.

`PLATFORM_ADMIN` does not enter member commands. It can inspect organization and installation
metadata directly through read-only operational RLS policies, without project/profile/settings
content.

## Validation

- fake-repository unit tests cover personal idempotency, shared creation, bounded roles and safe
  storage errors;
- native Supabase tests cover personal/shared listing, member role assignment and denial for an
  `ANALYST` attempting administration;
- HTTP tests prove workspace selection changes visible projects and a foreign user cannot select
  the shared workspace;
- the same SQL and Service matrices pass on dedicated Supabase staging.
