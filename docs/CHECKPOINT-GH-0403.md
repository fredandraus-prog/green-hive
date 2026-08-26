# GH-0403 — Jobs Foundation

## Delivered

- immutable migration `0019_create_jobs_foundation.sql`;
- `hive.job_registrations` and tenant-scoped `hive.jobs`;
- structural Reference App job registration synchronized with manifest `0.1.0`;
- protected, idempotent and entitlement-aware `hive.enqueue_project_job(...)`;
- forced RLS, least-privilege column grants and no authenticated writes;
- typed `@green-hive/jobs` service, repository, validation and stable errors;
- minimized transactional `JOB_QUEUED` Audit evidence;
- unit, embedded PostgreSQL and guarded native Supabase test suites.

## Acceptance result

GH-0403 is `DONE`. Clean verification, local Supabase, dedicated staging Supabase, GitHub CI,
Render readiness and the published authenticated HTTPS matrix all passed with nineteen immutable
ledger rows and no disposable Auth/database fixtures. The exact release identities and provider
evidence are recorded in
[GH-0403 release validation](VALIDATION-2026-08-26-GH0403-RELEASE.md).

## Not included

Worker claim, lease, heartbeat, retry scheduling, completion, permanent failure, cancellation,
real providers, AI execution, Redis, external brokers and Reference App domain handlers are not
implemented. They cannot be inferred from the schema's future lifecycle values.

## Recovery

Never edit migration `0019` after application. Prefer a reviewed forward-fix migration. Before a
controlled restoration, export and verify job registrations, queued jobs, Audit evidence and the
migration ledger. No destructive automatic `DOWN` file exists.
