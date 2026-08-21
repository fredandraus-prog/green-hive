# Validation evidence - 2026-08-18

## Environment

- Windows / PowerShell
- Node.js `v24.14.0`
- npm `11.9.0`
- WSL `2.7.12.0`, kernel `6.18.33.2`
- Docker Desktop `4.87.0`, Linux engine `29.7.2`
- Supabase CLI `2.115.0`, PostgreSQL `17.6`

## Local gate

- clean `npm ci`: passed;
- formatting and both platform linters: passed;
- TypeScript typecheck and 20-workspace build: passed;
- App Manifest, Auth/account, database, local-target and Project Service unit tests: 26 passed,
  0 failed;
- six-migration static database validation: passed;
- embedded PostgreSQL migrations, seed and RLS matrix: 9 passed, 0 failed;
- `npm audit --audit-level=high`: 0 known vulnerabilities;
- native Supabase external matrix: 10 passed, 0 failed;
- native Supabase Project Service integration matrix: 8 passed, 0 failed;
- native Supabase Auth/account integration matrix: 10 passed, 0 failed;
- total static/unit/embedded/native scenario checks: 63 passed, 0 failed;
- clean migration application: 6 applied, 6 checksums verified;
- migration and seed reapplication: passed without duplicate records;
- final Supabase smoke: native Auth helpers, ledger, seed, FKs, RLS, helpers and grants passed;
- local Auth and Mailpit ports verified as exclusive `127.0.0.1` bindings;
- full recovery email link produced a session and changed the password successfully;
- local stack restored to a clean baseline with zero Auth test users, projects and emails.

## Security scenarios

The embedded suite proved owner access, same-app cross-user denial, same-user cross-app denial,
forged owner/app rejection, isolation of user profiles/settings, rejection of `user_metadata`
elevation, read-only administration, logical deletion, post-deletion invisibility, retained data for
administration, seed reapplication, immutable seed-identity conflict detection and database-backed
checksum, filename, sequence, rollback metadata and unknown-migration rejection.

GH-0102 and GH-0103 remain `DONE`. GH-0202 remains `PARTIAL` until the framework-specific HTTP
boundary and staging integration are implemented.

GH-0104 is also `DONE`: fake-repository unit tests and native Supabase integration prove create,
list, get, archive, logical deletion, app/owner isolation, forged-payload rejection, idempotency,
safe errors and read-only administration.

GH-0201 is `PARTIAL — LOCAL_PASS`. Native Supabase Auth proved server-controlled account creation,
confirmed email/password login, refresh-token rotation, local logout, owner profile creation/update,
trusted `app_metadata`, rejection of forged `user_metadata`, cross-user project isolation, exact
recovery redirect allowlisting and full password replacement through Mailpit. The checkpoint cannot
be `DONE` until an explicitly authorized staging environment passes the canonical flow.

No staging project, production SMTP provider, social identity provider or remote secret was created
or modified.
