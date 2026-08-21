# Validation evidence - 2026-08-21

## Scope

This evidence covers the source-only hosted-staging preparation after platform `0.7.0`. It does
not claim that a Render service exists, that GitHub-hosted CI has run or that Supabase/Mailtrap
dashboard configuration has been changed.

## Preservation

The published `main` commit was clean and tracked `origin/main` before work began. A Git-archive
backup was created outside the repository:

```text
Engine/backups/green-hive-v0.7.0-pre-hosted-staging-20260821.zip
SHA-256: 55287058528f24560146c660314a80caf58126cae4fbe336c4c968de8ecfaa91
```

The implementation is isolated on `feat/gh0201-hosted-staging`. No migration, seed, product
manifest or historical `MANIFEST.csv` content was changed.

## Implemented and locally validated

- fail-closed local/hosted runtime configuration;
- exact public origin separated from the Render listener;
- hosted `0.0.0.0:$PORT` binding and local `127.0.0.1:3000` binding;
- exact Supabase project/Auth/database/callback validation;
- verified-TLS database requirement and bounded connection pool;
- secure hosted cookies and HSTS;
- liveness and database-backed readiness endpoints;
- application startup with no migration or seed command;
- Render Blueprint with five `sync: false` values;
- GitHub Actions clean-install workflow definition;
- repository credential/high-confidence-secret/browser-boundary scan;
- public read-only hosted smoke command;
- hosted preparation, secret-entry and rollback runbook.

## Gates passed

### Source and embedded gate

`npm run verify` passed with:

- format and platform boundary lint;
- source security scan;
- strict TypeScript check;
- 54 unit/contract tests, 0 failed;
- 11 immutable migrations and 9 RLS-protected tables validated;
- 9 embedded PostgreSQL/RLS/Audit tests, 0 failed;
- clean package and React production builds.

### Native local Supabase parity

`npm run verify:supabase` passed with runner-reported totals:

- database/RLS/Audit: 10 tests, 0 failed;
- Project/Workspace Service: 10 tests, 0 failed;
- Auth/account: 10 tests, 0 failed;
- HTTP/cookie boundary: 9 tests, 0 failed;
- final baseline: 11 ledger rows, one structural `REFERENCE_APP`, no disposable test users or
  project rows retained.

### Dependency and preview checks

- `npm audit --audit-level=high`: 0 vulnerabilities;
- real local preview: started successfully after migrations and seed were reapplied idempotently;
- `GET /api/health`: `200` with `status=ok`;
- `GET /api/ready`: `200` with `status=ready`;
- `GET /app`: `200` with the React HTML shell.

The real preview exposed one preparation regression during development: the local launcher had
historically forced `NODE_ENV=production`. The strict runtime correctly rejected that mismatch.
The launcher now declares development for the server, production only for the Vite build, and the
behavior is protected by a unit contract.

## Pending external evidence

- GitHub-hosted execution of the new CI workflow after the branch is pushed;
- Render Blueprint validation and first service creation;
- registration of the five values in the Render dashboard;
- exact Supabase Site URL and recovery callback configuration;
- Mailtrap custom SMTP configuration in Supabase Auth;
- public hosted smoke gate;
- complete HTTPS cookie/Auth/recovery/isolation matrix;
- post-hosting database network review;
- GH-0204 deployed rate limits and secret operations.

GH-0201 and GH-0202 remain `PARTIAL - HOSTING_PREPARATION_PASS`. Platform version remains `0.7.0`;
no `0.8.0` release, tag or ZIP is produced before the hosted acceptance evidence passes.
