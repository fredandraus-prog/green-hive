# GH-0601 implementation validation — 2026-09-05

This evidence records implementation validation only. Release, CI, hosted staging, source manifest
and ZIP evidence are recorded separately after those operations are observed.

| Gate | Result |
|---|---|
| `npm ci` | pass; 149 packages, zero reported vulnerabilities |
| `npm run build:types` | pass |
| focused `tests/unit/file-service.test.mjs` | pass; 6 scenarios |
| `npm run db:validate` | pass; 23 immutable migrations and 26 RLS-protected tables |
| embedded `file-service.integration.test.mjs` | pass; 1 tenant/RLS lifecycle scenario |
| native `files:test:supabase` | pass; 1 guarded local-Supabase metadata/RLS scenario |
| guarded Supabase smoke | pass; ledger `23`, seed, native Auth, FK/RLS/helpers/grants verified |

The native test uses the guarded loopback-only `postgres` database at port `54322`, requires the
exact local target and destructive confirmation, creates only approved fixture users/rows and
cleans them in `finally`. It proved the `authenticated` role cannot write file rows, call a
lifecycle writer or read `storage_key`; it also proved cross-user, cross-app and administrative
reads are denied.

The local Supabase service still runs database/Auth/Mailpit only. Its Storage API is not activated,
and no real bucket/object write was attempted. `SupabasePrivateStorageProvider` is therefore tested
through a strict in-memory client double, while `FakeFileStorage` gives deterministic byte-lifecycle
coverage without a network call or provider account. This is intentional scope control, not an
assertion that a remote Storage deployment was completed.

