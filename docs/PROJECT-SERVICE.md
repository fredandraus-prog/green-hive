# GH-0104 Project Service

`@green-hive/projects` is the server-side owner of project lifecycle and organization/app/owner scope. It does
not own app-specific content and does not expose HTTP endpoints before GH-0201 establishes verified
authentication and session claims.

## Public contracts

- `Project` and `ProjectStatus` (`DRAFT`, `ACTIVE`, `ARCHIVED`, `DELETED`);
- `CreateProjectInput`;
- `ProjectRepository`;
- `ProjectService`;
- `PostgresProjectRepository` and its minimal SQL executor contract;
- `ProjectError` and stable error codes.

The service surface is:

```text
create(context, input) -> Project
list(context) -> Project[]
get(context, projectId) -> Project
archive(context, projectId) -> Project
softDelete(context, projectId) -> void
```

## Trust and validation

Project operations require `TrustedOrganizationContext` from `@green-hive/core`, containing
`userId`, `appCode`, database-validated `organizationId` and an optional verified platform role.
Runtime validation rejects malformed context and extra context
fields. `CreateProjectInput` accepts only `name` and optional JSON `metadata`; `owner_user_id`,
`organization_id`, `app_id` and any other extra payload keys are rejected.

The PostgreSQL adapter verifies that all of the following agree before executing SQL:

```text
context.userId = auth.uid()
context.appCode = hive.current_app_code()
context.organizationId = hive.current_organization_id()
hive.current_app_id() exists
hive.has_trusted_organization_context() = true
```

Write operations additionally reject native platform-admin claims. This explicit check remains in
place even when a future server connection could bypass RLS.

## Lifecycle behavior

- `create` writes `DRAFT` and derives organization, app and owner from trusted context;
- `list` and `get` explicitly filter owner, organization, app and `status <> 'DELETED'`;
- `archive` moves `DRAFT` or `ACTIVE` to `ARCHIVED`; repeated calls preserve timestamps;
- `softDelete` calls the validated SQL helper and is deliberately idempotent;
- a repeated delete or an unavailable opaque ID is a no-op, preventing resource-existence leaks;
- deleted projects remain stored for controlled retention and are not physically deleted;
- platform administrators cannot reuse private Project Service read or write commands.

## Public errors

| Code | Meaning |
|---|---|
| `PROJECT_NOT_FOUND` | project is absent or outside the caller scope |
| `PROJECT_ACCESS_DENIED` | trusted context or write authority is invalid |
| `INVALID_PROJECT_TRANSITION` | lifecycle transition is not allowed |
| `INVALID_PROJECT_INPUT` | runtime input validation failed |
| `PROJECT_OPERATION_FAILED` | sanitized storage failure |

Errors do not attach SQL errors as causes and their messages contain no table, query, provider or
stack details. The eventual HTTP layer must map these codes without serializing internal stacks.

## Verification

`npm run test:unit` covers the service with a fake repository. `npm run db:test:supabase` also runs
the compiled PostgreSQL adapter through the native `authenticated` role, covering cross-user,
cross-app, cross-organization, forged payloads, JWT/context mismatch, archive/delete idempotency
and private-content denial for platform administrators.
