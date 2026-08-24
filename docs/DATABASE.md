# Database foundation

## Schema boundaries

| Schema | Purpose in this checkpoint |
|---|---|
| `hive` | ledger, app registry, organizations, projects, Billing/Entitlements/Usage accounting and RLS helpers |
| `audit` | append-only operational accountability events |
| `reference_app` | reserved for Reference App domain migrations |

No app-domain concepts belong in `hive`.

## Core tables

- `hive.schema_migrations`: sequence, filename, SHA-256, rollback strategy, duration and actor.
- `hive.apps`: `app_code`, version, status, schema namespace, canonical manifest and metadata.
- `hive.user_profiles`: app-neutral profile with PK/FK to `auth.users(id) ON DELETE CASCADE`.
- `hive.organizations`: personal/shared tenant identity and lifecycle.
- `hive.organization_members`: active membership with `OWNER`, `ADMIN`, `DEVELOPER`, `ANALYST`
  or `VIEWER` role.
- `hive.organization_apps`: tenant installation of a global `hive.apps` definition; this stable
  pair prepares future Billing ownership without implementing Billing.
- `hive.organization_app_members`: optional app-scoped role narrowing for workspace members.
- `hive.projects`: owner, organization and installed-app FKs, lifecycle and metadata.
- `hive.project_settings`: locale, timezone, country, currency, measurements and JSON settings,
  protected by the composite `(project_id, app_id, organization_id)` foreign key.
- `hive.products`: app-scoped generic catalog using only canonical App Manifest product types.
- `hive.prices`: immutable-version exact-decimal prices with currency, locale and validity window.
- `hive.purchases`: owner/project/app/workspace-scoped commercial snapshots and hashed idempotency.
- `hive.payments`: server-authoritative payment attempts and exact refund amount; authenticated
  reads exclude provider payment/refund references and failure internals.
- `hive.product_entitlement_capabilities`: reviewed product-to-App-Manifest capability mapping.
- `hive.project_entitlements`: immutable purchase/capability grant snapshots with explicit active
  or revoked lifecycle.
- `hive.usage_budgets`: exact-decimal project/cycle ceilings with constrained future consumed and
  reserved fields.
- `hive.usage_events`: append-only logical debit/credit quantities.
- `hive.cost_events`: separate append-only exact-decimal monetary provider/platform costs.
- `hive.cost_guard_decisions`: append-only entitlement/budget decisions keyed by trusted operation.
- `hive.cost_guard_reservations`: exact-decimal `RESERVED`, `CONSUMED` or `RELEASED` lifecycle.
- `audit.events`: immutable actor/tenant/app/project event metadata with request and correlation
  identifiers, protected by tenant-aware read RLS and no authenticated write grant.

Project states are `DRAFT`, `ACTIVE`, `ARCHIVED` and `DELETED`. Check constraints synchronize
`archived_at` and `deleted_at`. Physical deletion is not granted to authenticated users.

The global app registry is deliberately not duplicated per organization. The tenant hierarchy is:

```text
USER -> ORGANIZATION / WORKSPACE -> ORGANIZATION_APP -> PROJECT -> PURCHASE -> PAYMENT
                                                                    -> ENTITLEMENT SNAPSHOTS
                                                                    -> USAGE BUDGETS/EVENTS
                                                                     -> COST EVENTS
                                                                    -> COST GUARD DECISIONS/RESERVATIONS
```

## Deployment workflow

1. Run `npm ci` and `npm run verify` on the release artifact.
2. Confirm a verified database recovery point.
3. Set a dedicated deployment `DATABASE_URL`.
4. Run `npm run db:validate` and `npm run db:migrate`.
5. Run `npm run db:seed` for the structural `REFERENCE_APP` and sandbox catalog seeds.
6. Execute `npm run db:test:supabase` against the guarded local Supabase environment.
7. Record hashes and evidence before promotion.

## Audit write boundary

Organization, membership, app-installation and project lifecycle triggers append safe events in the
same transaction as the domain mutation. Authenticated clients cannot directly insert, update or
delete audit rows. Test cleanup uses an explicit superuser-only fixture allowlist; it is not a
production retention mechanism. See `docs/AUDIT.md`.

## Billing authority

Authenticated roles receive read-only catalog and owner-scoped commercial history. They receive no
direct write grant on `products`, `prices`, `purchases` or `payments`. Pending purchase creation is
the only authenticated Billing write entrypoint. The trusted backend uses separately revoked
provider-result/refund functions; those functions are not executable by `authenticated`, repeat
explicit user/app/workspace authorization, lock the purchase/payment rows and make exact retries
idempotent. All three functions have empty `search_path`, schema-qualified objects and explicit
`PUBLIC` revocation. Amount, currency, commercial scope and sandbox outcome are never accepted
from a browser payload.

## Entitlement authority

Authenticated roles can read only current-app capability mappings and owner-scoped grant snapshots.
They receive no direct grant-table write privilege and cannot execute
`hive.apply_entitlement_state_for_purchase(uuid)`. Paid/refunded Billing transitions invoke the
internal synchronizer in the same database transaction. `hive.can_project_capability(uuid,text)` is
the only authenticated SQL decision entrypoint and repeats verified user, app, organization,
project-status, mapping and manifest checks. Multiple purchases remain independent: revoking one
does not negate another active grant for the same project/capability.

## Usage and cost authority

Authenticated clients cannot write budgets, usage events or cost events and cannot execute their
internal writer functions. Owner reads are limited to their project budgets and logical usage;
raw monetary costs are visible only through platform-administration inspection RLS. Every server
writer repeats trusted user/app/workspace/project scope and hashes the idempotency identity.
Accounting rows are append-only. GH-0402 functions are server-only, lock the selected budget,
check the active entitlement and atomically reserve, consume or release exact-decimal cost. A
consume transition also records the matching monetary cost event in the same transaction. Owners
and administrators have limited read columns but no direct write or function-execution authority.
