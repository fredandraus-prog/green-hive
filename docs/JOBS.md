# Jobs and Worker foundation

GH-0403 introduced Green Hive's PostgreSQL-backed queue boundary. GH-0404 completes its safe Worker
lifecycle without adding a continuously running process. The database remains the canonical first
queue because it preserves the same transaction, tenant and Audit guarantees already validated by
the platform. Redis and external brokers are not required.

## Registration

Every accepted type exists in `hive.job_registrations` and in the app's stored App Manifest.
Registration records the handler owner, optional required capability and cost-budget class,
idempotency strategy, retry policy, maximum attempts and timeout class. The structural Reference
App seed registers only `REFERENCE_APP_FAKE_AI_JOB`, already declared by manifest `0.1.0`.

## Enqueue boundary

`JobService.enqueue(...)` accepts only:

- `projectId`;
- a namespaced `jobType`;
- a bounded idempotency key;
- a SHA-256 of already validated domain input;
- an optional opaque input reference;
- optional priority from 0 through 100.

Owner, app and workspace never come from this input. `hive.enqueue_project_job(...)` repeats the
trusted `auth.uid()`, signed app claim, selected organization, project ownership, manifest,
registration and entitlement checks. The raw idempotency key is hashed before persistence. The raw
domain payload remains in its owning service or storage boundary and is never copied into the
queue.

An exact retry returns the original job. Reusing the key with a different fingerprint returns the
stable `JOB_IDEMPOTENCY_CONFLICT` error. Concurrent inserts use the same database uniqueness
boundary and cannot create duplicate work.

## Read and authorization

Authenticated owners and read-only platform administrators can read only the sanitized status
columns. Input/reference hashes and idempotency fingerprints have no authenticated column grant.
There is no authenticated insert, update, delete or enqueue-function grant, and forced RLS remains
active on both tables.

`JOB_QUEUED` is appended in the same transaction with job type, status, priority, max attempts and
timeout class. Audit does not retain input references, hashes, keys or domain content.

## Worker lifecycle

Migration `0020` adds server-only functions for claim, heartbeat, completion,
transient/permanent failure, cancellation and bounded expired-lease recovery. Claims are ordered by
priority, availability and stable ID, and use `FOR UPDATE SKIP LOCKED`; concurrent workers cannot
own the same job.

The claimant supplies only a validated worker identity and lease duration. PostgreSQL generates a
random lease token, returns the raw value once and persists only its SHA-256 digest. Every later
mutation must match job ID, worker ID and token digest while the lease remains unexpired. A stale,
forged or already-consumed token produces `WORKER_LEASE_LOST` without revealing database details.

Heartbeats renew leases for 15 through 3,600 seconds. A transient failure schedules `RETRYING` only
when policy and remaining attempts allow it. `FIXED` waits 30 seconds; `EXPONENTIAL_BACKOFF` waits
5, 10, 20 seconds and continues doubling with a one-hour cap. `NONE`, permanent failure and attempt
exhaustion transition to `FAILED`. Recovery uses a bounded `SKIP LOCKED` batch and applies the same
rules to abandoned `RUNNING` jobs.

Completion may persist only an opaque output reference and/or its SHA-256 identity. Cancellation,
completion and terminal failure clear lease material. Lifecycle constraints reject partial lease
states, output on non-completed work and retries beyond `max_attempts`.

## Worker authorization and Audit

Only `service_role` can execute Worker lifecycle functions. `authenticated` and `PUBLIC` are
explicitly revoked; owners and platform administrators retain their prior sanitized read-only
projection and cannot select lease, token-hash or output columns.

Status transitions append minimized `JOB_STARTED`, `JOB_RETRY_SCHEDULED`, `JOB_COMPLETED`,
`JOB_FAILED` and `JOB_CANCELLED` events. Audit records contain status, attempt bounds and a safe
error code, but never lease identities, input/output references, hashes or raw content.

## Deliberate process boundary

GH-0404 delivers the lifecycle authority as a library and immutable SQL contract. It does not add a
polling daemon, Render background worker, Redis, an external broker, AI execution, provider calls or
a Reference App domain handler. Those require explicit later checkpoints and deployment decisions.
