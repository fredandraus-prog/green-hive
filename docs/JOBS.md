# Jobs foundation

GH-0403 introduces Green Hive's PostgreSQL-backed queue boundary without implementing a Worker.
The database is the canonical first queue because it preserves the same transaction, tenant and
Audit guarantees already validated by the platform. Redis and external brokers are not required
for this checkpoint.

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

## Deliberate GH-0404 boundary

Migration `0019` recognizes the canonical lifecycle values `QUEUED`, `RUNNING`, `RETRYING`,
`COMPLETED`, `FAILED` and `CANCELLED`, but GH-0403 creates only `QUEUED` with `attempt_count = 0`.
There is no claim, heartbeat, retry, completion, failure or cancellation function. GH-0404 must add
those transitions in a new immutable migration and test transient/permanent failure behavior.
