# Green Hive database

The database layer targets Supabase PostgreSQL. The immutable history through GH-0402 contains the
platform foundation, tenant-aware trusted context, row-level security, append-only Audit capture
and server-authoritative sandbox payment transitions, verified provider-event deduplication and
payment-derived project capability grants, exact-decimal project budgets and separate append-only
logical usage and monetary cost ledgers, plus entitlement-aware atomic cost reservations and
no-overspend decisions.

## Layout

- `migrations/`: eighteen sequential immutable migrations plus `migrations.json`.
- `seeds/`: only stable structural data; `REFERENCE_APP`, its manifest-registered sandbox catalog
  and reviewed product-to-capability mappings.
- `tests/fixtures/`: disposable users, a second app and other test-only identities.
- `tests/`: embedded and guarded native Supabase migration, RLS, service and audit suites.
- `policies/`: policy behavior documentation.

Run `npm run db:validate` before every migration or seed operation. Never edit a migration already
recorded in `hive.schema_migrations`; add the next forward migration instead.

`supabase/config.toml` does not own migrations or seeds. `database/migrations` and
`database/seeds` remain the only canonical inputs used by the Green Hive runners.
