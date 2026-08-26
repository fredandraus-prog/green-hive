# GH-0404 — Worker Foundation

## Delivered

- immutable migration `0020_create_worker_lifecycle.sql` without changes to migrations `0001`–`0019`;
- exclusive, priority-ordered claims using `FOR UPDATE SKIP LOCKED`;
- one-time raw lease tokens with only SHA-256 digests persisted;
- heartbeat renewal and exact worker/token/expiry ownership checks;
- deterministic retry: 30 seconds for `FIXED`, and exponential 5-second base capped at one hour;
- permanent failure and automatic exhaustion at `max_attempts`;
- completion with optional opaque output reference/hash, cancellation and bounded expired-lease recovery;
- service-role-only functions and no authenticated access to lease/output internals;
- minimized transactional lifecycle Audit events;
- typed Worker service/repository, strict runtime validation and stable safe errors;
- unit, embedded PostgreSQL and guarded native local Supabase matrices.

## Acceptance status

GH-0404 is `DONE`. Migration `0020` passed on the dedicated Supabase staging project, both GitHub
CI checks passed, Render reported the twenty-migration readiness contract, and public, security and
authenticated HTTPS acceptance gates passed with final cleanup. See the
[release validation](VALIDATION-2026-08-26-GH0404-RELEASE.md).

## Boundaries

This checkpoint defines the safe lifecycle authority, not a continuously running execution
process. It creates no Redis instance, message broker, Render background worker, AI call, external
provider or Reference App domain handler. Those require later explicit checkpoints.

## Recovery

Never edit migration `0020` after application. Prefer a reviewed forward-fix migration. Before a
controlled restoration, stop claimers, let or recover live leases, export and verify jobs and Audit
evidence, and preserve the migration ledger. No destructive automatic `DOWN` file exists.
