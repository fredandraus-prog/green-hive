# Green Hive database

The database layer targets Supabase PostgreSQL. The immutable history through GH-0505 contains the
platform and tenant-security foundation, append-only Audit, Billing/Entitlements, exact-decimal
Usage/Cost and Cost Guard, the PostgreSQL Job/Worker lifecycle and metadata-only AI Gateway
operations with server-only terminal writers. It now also contains tenant-safe, metadata-only
Search Gateway operations. Twenty-five tables are protected by RLS, including `audit.events`.

## Layout

- `migrations/`: twenty-two sequential immutable migrations plus `migrations.json`.
- `seeds/`: only stable structural data; `REFERENCE_APP`, its manifest-registered sandbox catalog
  and reviewed product-to-capability and job-registration mappings.
- `tests/fixtures/`: disposable users, a second app and other test-only identities.
- `tests/`: embedded and guarded native Supabase migration, RLS, service and audit suites.
- `policies/`: policy behavior documentation.

Run `npm run db:validate` before every migration or seed operation. Never edit a migration already
recorded in `hive.schema_migrations`; add the next forward migration instead.

`supabase/config.toml` does not own migrations or seeds. `database/migrations` and
`database/seeds` remain the only canonical inputs used by the Green Hive runners.

Migration `0022` stores only Search operation identity, tenant scope, Trust/Cost decisions,
provider-neutral counters and safe terminal state. Queries, URLs, snippets and result content are
never stored in `hive.search_operations`. Owners and platform administrators may read the allowed
metadata through RLS. Only `service_role` may start an operation, invoke
`hive.complete_search_operation_accounted(...)`, atomically fail a reserved operation through
`hive.fail_search_operation_accounted(...)`, or fail an operation that has no reservation through
the simple failure writer. The lower-level `hive.complete_search_operation(...)` helper is private.
Accounted completion consumes the Cost Guard reservation, records logical usage and marks the
Search operation successful atomically. Accounted failure releases the reservation and records the
failed operation/Audit transition atomically. Both accounted writers reject a reservation whose
estimated amount differs from the operation estimate; the simple failure writer rejects an
operation if any reservation exists.

The reservation estimate is request unit cost multiplied by maximum attempts plus result unit cost
multiplied by maximum results. A successful actual cost is request unit cost multiplied by the
physical provider-attempt count, including retries, plus result unit cost multiplied by the number
of returned results.

The operation start function compares the literal complete app code plus `_` against the identifier
prefix. App codes containing underscores are therefore checked without ambiguous string splitting.

Routine embedded, local Supabase and staging database tests use `FakeSearchProvider`. The fake is
deterministic, performs no network request and incurs no external provider cost.
