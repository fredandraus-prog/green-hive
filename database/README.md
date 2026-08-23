# Green Hive database

The database layer targets Supabase PostgreSQL. The immutable history through GH-0302 contains the
platform foundation, tenant-aware trusted context, row-level security, append-only Audit capture
and server-authoritative sandbox payment transitions.

## Layout

- `migrations/`: fourteen sequential immutable migrations plus `migrations.json`.
- `seeds/`: only stable structural data; `REFERENCE_APP` and its manifest-registered sandbox catalog.
- `tests/fixtures/`: disposable users, a second app and other test-only identities.
- `tests/`: embedded and guarded native Supabase migration, RLS, service and audit suites.
- `policies/`: policy behavior documentation.

Run `npm run db:validate` before every migration or seed operation. Never edit a migration already
recorded in `hive.schema_migrations`; add the next forward migration instead.

`supabase/config.toml` does not own migrations or seeds. `database/migrations` and
`database/seeds` remain the only canonical inputs used by the Green Hive runners.
