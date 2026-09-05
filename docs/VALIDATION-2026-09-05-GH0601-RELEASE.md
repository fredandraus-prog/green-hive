# GH-0601 release validation — 2026-09-05

## Scope and release identity

This evidence closes GH-0601 Private File Metadata and Storage Service for coordinated platform
version `0.23.0`. The `REFERENCE_APP` product manifest remains `0.1.0`.

```text
feature branch:      feat/gh0601-private-files-v0230
feature commits:     206f46c, b80ecf0
feature PR:          #35
feature merge:       a4f7dff7f82b9cf2e107b160e141227c7b9d70ee
public origin:       https://green-hive-staging.onrender.com
```

PR: <https://github.com/fredandraus-prog/green-hive/pull/35>

## Verified gates

- Feature-push and pull-request CI both passed after the release manifest was regenerated.
- The merged-main CI run `33956105909`, job `101279634741`, passed.
- Local `npm run verify` passed with 166 unit tests, embedded database scenarios, 23 immutable
  migrations and 26 RLS-protected tables.
- `npm audit --audit-level=high` reported zero vulnerabilities.
- The guarded native local-Supabase File matrix passed. It proves owner-only safe reads, denied
  authenticated writes/lifecycle functions/protected-column access, and cross-user/cross-app/admin
  denial.
- Dedicated staging applied only migration `0023_create_private_files_foundation.sql`, re-applied
  the structural seeds, and ended with ledger `23`, zero pending migrations and zero fixture users,
  profiles, projects, settings or apps.
- The public hosted smoke passed liveness, database readiness, HTTPS headers, security headers and
  Reference App shell. The hosted security smoke returned `HOSTED_SECURITY_SMOKE_PASS`, including
  bounded invalid authentication attempts and exempt health probes.

Migration `0023` is recorded with SHA-256
`8356022cc09177f6d152ea9ea7b12020db07830c1cc7662f15095a90047c4522`.

## Scope confirmation

No Storage API service, real bucket, remote object, user upload, public URL, signed URL, rendering
worker, provider credential, OpenAI request or paid service was introduced. The release validates the
metadata/private-service boundary with deterministic fake storage and an injected private Supabase
adapter. An actual private-bucket activation and authorized delivery continue as separately reviewed
operational/GH-0602 work.

## Distribution handoff

After this evidence is added, the release branch regenerates and verifies the SHA-256 source
manifest. The final source-only ZIP, extraction check, clean install/verification and tag are
recorded only after those actions are observed.

