# GH-0403 implementation validation — 2026-08-26

## Preservation and scope

- base: tag `v0.15.0`, commit `e767f914b4741c9f853d634dd531680c853833bd`;
- branch: `feat/gh0403-jobs-foundation-v0160`;
- isolated worktree: `Engine/worktrees/green-hive-gh0403-jobs`;
- pre-slice source backup:
  `Engine/backups/green-hive-v0.15.0-pre-gh0403-20260826-143256.zip`;
- backup SHA-256:
  `1731B69A1DDCD4DB15BB1E191AAD956C606A301485A677DE5DF7AAC74ECCACC1`.

The canonical dirty worktree, previous ZIPs and migrations `0001` through `0018` were not edited.
No Billing provider, AI execution, Redis, external broker, Worker or app-domain handler was added.

## Delivered contract

Migration `0019_create_jobs_foundation.sql` adds app/manifest-backed job registrations, a
tenant-scoped queue, protected idempotent enqueue, forced RLS, least-privilege status reads and
transactional `JOB_QUEUED` capture. Only SHA-256 identities and an optional opaque reference are
stored; raw job payload and raw idempotency key are absent.

The Reference App structural seed registers `REFERENCE_APP_FAKE_AI_JOB` with capability
`REFERENCE_APP_RUN_JOB`, exponential retry policy, maximum three attempts and short timeout. The
schema recognizes future lifecycle values, but GH-0403 creates only `QUEUED` jobs with zero
attempts. GH-0404 owns every Worker transition.

## Clean local evidence

```text
npm ci                  PASS; 170 packages, 0 vulnerabilities
npm run verify          PASS
unit tests              107 passed, 0 failed
embedded database       18 passed, 0 failed
db:validate             19 immutable migrations, 23 RLS-protected tables
security bundle smoke   PASS; private secrets absent
```

The Jobs matrix proves entitlement-first denial, exact idempotent replay, conflicting-key
rejection, registered type enforcement, cross-user/app/workspace denial, sanitized owner/admin
read, no authenticated writes/function execution and minimized Audit metadata.

## Native local Supabase

The guarded gate started only after Docker Desktop's Linux engine was healthy. It applied all 19
migrations to a clean managed baseline, reapplied without a ledger duplicate, applied four seeds
twice, ran all native parity suites and restored a clean seeded baseline. Final smoke evidence:

```text
ledger=19
REFERENCE_APP=1
sandbox catalog=1
job registrations=1
native Auth/FKs/RLS/helpers/grants=PASS
```

One initial Jobs assertion used user B with user A's workspace and correctly received
`JOB_ACCESS_DENIED`. The test was corrected to use B's legitimate workspace, after which the job
was safely indistinguishable as `JOB_NOT_FOUND`; no authorization rule was weakened.

## Dedicated Supabase staging

The guarded preflight identified exactly 18 applied and one pending migration. Apply added only
`0019`, reapplied the migrator without duplication and applied the four structural seeds twice.
The full hosted database matrix passed, including the native GH-0403 job scenario. Final preflight:

```text
project: green-hive-staging / rabkyesatfuezmrrzllx / sa-east-1
status: ACTIVE_HEALTHY
state: BASELINE_READY
applied: 19
pending: 0
test users/profiles/projects/settings/apps: 0/0/0/0/0
```

An initial preflight failed before connection with transient DNS `EAI_FAIL`; DNS and TCP/5432
then resolved normally and the unchanged preflight passed. No database mutation occurred during
that failed attempt.

## Recovery

Migration `0019` is immutable after staging application. Any correction must be a reviewed
next-numbered forward migration. Before controlled restoration, export and verify registrations,
queued jobs, Audit evidence and migration-ledger state. Never rewrite an applied checksum.
