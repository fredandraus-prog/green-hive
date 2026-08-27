# Green Hive database

The database layer targets Supabase PostgreSQL. The immutable history through GH-0503 contains the
platform and tenant-security foundation, append-only Audit, Billing/Entitlements, exact-decimal
Usage/Cost and Cost Guard, the PostgreSQL Job/Worker lifecycle and metadata-only AI Gateway
operations with server-only terminal writers.

## Layout

- `migrations/`: twenty-one sequential immutable migrations plus `migrations.json`.
- `seeds/`: only stable structural data; `REFERENCE_APP`, its manifest-registered sandbox catalog
  and reviewed product-to-capability and job-registration mappings.
- `tests/fixtures/`: disposable users, a second app and other test-only identities.
- `tests/`: embedded and guarded native Supabase migration, RLS, service and audit suites.
- `policies/`: policy behavior documentation.

Run `npm run db:validate` before every migration or seed operation. Never edit a migration already
recorded in `hive.schema_migrations`; add the next forward migration instead.

`supabase/config.toml` does not own migrations or seeds. `database/migrations` and
`database/seeds` remain the only canonical inputs used by the Green Hive runners.
