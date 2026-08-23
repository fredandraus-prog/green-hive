# Database foundation

## Schema boundaries

| Schema | Purpose in this checkpoint |
|---|---|
| `hive` | ledger, app registry, organizations, projects, Billing catalog/ledger and RLS helpers |
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
- `hive.payments`: server-authoritative payment attempts; authenticated reads exclude provider refs.
- `audit.events`: immutable actor/tenant/app/project event metadata with request and correlation
  identifiers, protected by tenant-aware read RLS and no authenticated write grant.

Project states are `DRAFT`, `ACTIVE`, `ARCHIVED` and `DELETED`. Check constraints synchronize
`archived_at` and `deleted_at`. Physical deletion is not granted to authenticated users.

The global app registry is deliberately not duplicated per organization. The tenant hierarchy is:

```text
USER -> ORGANIZATION / WORKSPACE -> ORGANIZATION_APP -> PROJECT -> PURCHASE -> PAYMENT
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
the single reviewed `SECURITY DEFINER` entrypoint; it has an empty `search_path`, schema-qualified
objects, explicit `PUBLIC` revocation and derives all authority from `auth.uid()` plus trusted app
and workspace helpers. Amount, currency, product snapshot, owner and tenant scope are resolved in
the transaction rather than accepted from the caller.
