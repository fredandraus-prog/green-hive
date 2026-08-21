# Audit Foundation

## Boundary

Audit records accountability events. It does not replace application business history and it is
not an observability/log aggregation system. GH-0203 stores only bounded operational metadata that
is useful for answering who performed a meaningful action, in which tenant/app scope, when, and as
part of which correlated request.

The service must never routinely store:

- passwords, access/refresh tokens, cookies, authorization headers or API keys;
- project names, arbitrary project metadata or consumer-domain content;
- prompts, documents, generated content or raw HTTP/provider payloads;
- payment-card or other confidential data.

## Event store

`audit.events` is created by immutable migration `0011`. Every row contains:

- immutable event identity and timestamp;
- stable `event_code`, actor type and optional authenticated actor UUID;
- organization and app scope, plus an optional project UUID;
- subject type/UUID and outcome;
- request and correlation UUIDs;
- a JSON object limited to 2 KiB with explicitly non-confidential operational fields.

Authenticated users receive only `SELECT`. They receive no table `INSERT`, `UPDATE` or `DELETE`
privilege and there are no authenticated write/delete RLS policies. Internal capture functions and
triggers are revoked from `PUBLIC` and from the authenticated role.

## Transactional capture

The database captures the first safe event for each material lifecycle change:

| Operation | Event |
|---|---|
| personal or shared organization inserted | `ORGANIZATION_CREATED` |
| organization member inserted | `ORGANIZATION_MEMBER_ADDED` |
| member role/status genuinely changes | `ORGANIZATION_MEMBER_CHANGED` |
| app installation inserted | `ORGANIZATION_APP_INSTALLED` |
| project inserted | `PROJECT_CREATED` |
| project first enters `ARCHIVED` | `PROJECT_ARCHIVED` |
| project first enters `DELETED` | `PROJECT_DELETION_REQUESTED` |

Capture runs after the domain row change inside the same database transaction. A capture failure
rolls the operation back. An idempotent retry that does not create a row or change lifecycle state
does not create a duplicate event.

The transaction-scoped authenticated runner generates one UUID and places it in both
`request.green_hive.request_id` and `request.green_hive.correlation_id`. Database-only operations
without that runner receive a generated fallback request/correlation UUID.

## Authorization

Tenant reads require all of:

```text
event.organization_id = hive.current_organization_id()
AND event.app_id = hive.current_app_id()
AND hive.has_trusted_organization_context()
```

The selected organization is validated against active membership before the query. Browser
headers, query strings, request bodies and the workspace preference cookie are not database
authorization sources.

`PLATFORM_ADMIN` may read the safe operational event shape under the SQL policy, but the tenant
`AuditService.list` command rejects administrative reuse. A future admin audit view must remain
metadata-only. Break-glass private-content access remains separately deferred in `IDEAS_RADAR.md`.

## Public package

`@green-hive/audit` publishes:

- the versioned audit event-code, actor, subject and outcome catalogs;
- `AuditEvent`, `AuditMetadata` and list-window contracts;
- runtime context and window validation;
- `AuditService` with stable public errors;
- `PostgresAuditEventRepository` with a second trusted-authority check.

The Reference App exposes `GET /api/audit` only through its verified HttpOnly-cookie session and
server-selected workspace. The browser receives no credentials or private domain payload through
this endpoint.

## Retention and future work

The exact production retention duration remains `TO_DEFINE`, matching the platform retention
registry. Purging must be a separately authorized, audited operational workflow with verified
retention/legal requirements; it is not part of GH-0203.

Login failure/success, Billing, Entitlements, Jobs, Files, feature flags, provider health, external
webhooks and break-glass events remain cataloged contracts or future integration points. GH-0203
does not implement those subsystems.
