# GH-0250 — Organizations & Multi-Tenancy Foundation

## Decision

Green Hive adopts the hierarchy below before Billing:

```text
USER -> ORGANIZATION / WORKSPACE -> APP INSTALLATION -> PROJECT
```

This decision supersedes the original v1 non-goal for organizations for the operational repository.
The external Platform 1.0 specification remains unchanged as historical source material. The new
foundation was explicitly approved in the shared architecture conversation on 2026-08-19.

The canonical `hive.apps` table remains the global definition registry. Organizations do not own
or duplicate an app definition; they install it through `hive.organization_apps`. This preserves a
single manifest identity while allowing the same app to serve many workspaces.

## Checkpoint composition

| ID | Deliverable |
|---|---|
| GH-0251 | Organizations and lifecycle constraints |
| GH-0252 | Organization memberships and workspace roles |
| GH-0253 | One automatically provisioned personal workspace per user |
| GH-0254 | Organization app installations without duplicating global app definitions |
| GH-0255 | Optional app-scoped membership and permissions |
| GH-0256 | Tenant-aware trusted context and RLS |
| GH-0257 | Cross-organization isolation tests |
| GH-0258 | Minimal shared-workspace creation and membership administration |
| GH-0259 | Billing ownership preparation through stable organization/app identities only |

## Roles

Workspace roles are `OWNER`, `ADMIN`, `DEVELOPER`, `ANALYST` and `VIEWER`. App-scoped roles are
`APP_ADMIN`, `DEVELOPER`, `ANALYST` and `VIEWER`. Role assignment does not grant platform-level
authority and does not bypass row-level security.

## Privacy boundary

- Project content remains private to its owner in the selected organization and app.
- Workspace administrators manage workspace metadata, installations and memberships; they do not
  automatically inherit access to private project content.
- `PLATFORM_ADMIN` can inspect operational organization and app-installation metadata, but loses
  the previous automatic RLS path to profiles, projects and project settings.
- Emergency `break-glass` content access is not implemented. It remains in `IDEAS_RADAR.md` until
  approvals, Audit and time-bound access controls exist.

## Trusted organization selection

The browser may request a workspace identifier, but that value is not authorization by itself. The
server verifies the signed Auth identity, checks active organization membership inside the same
database transaction, and only then sets a transaction-local trusted organization context. RLS
reads that validated context through `hive.current_organization_id()`.

For a new account, Green Hive creates one personal organization, grants its user `OWNER`, and
installs `REFERENCE_APP`. Users can later belong to multiple shared workspaces and select among
their active memberships.

## Explicitly deferred

Billing, chargeback, portfolio forecasting, AI Insights, external app migration automation,
infrastructure splitting, webhooks, Redis/queues and break-glass administration are outside
GH-0250. Their future triggers are retained in the Ideas Radar.

## Validation result

Status: `DONE` on 2026-08-20.

- ten immutable ledger entries and zero pending migrations;
- embedded tenant RLS matrix: 9/9 tests;
- native local Supabase database/RLS matrix: 10/10 tests;
- native local Project/Workspace Service matrix: 10/10 tests;
- native local Auth/account matrix: 10/10 tests;
- native local HTTP/cookie matrix: 8/8 tests;
- dedicated hosted staging RLS matrix: 10/10 tests;
- dedicated hosted staging Project/Workspace Service matrix: 10/10 tests;
- dedicated hosted staging Auth/account matrix: 8/8 tests;
- staging cleanup retained ten ledger rows, one structural `REFERENCE_APP` and no disposable users,
  projects or workspaces.
