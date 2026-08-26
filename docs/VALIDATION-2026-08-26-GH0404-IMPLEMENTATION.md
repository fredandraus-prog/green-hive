# GH-0404 implementation validation — 2026-08-26

## Preserved baseline

- source base: Green Hive `0.16.0`, tag `v0.16.0`, commit `993101e`;
- pre-slice archive: `green-hive-v0.16.0-pre-gh0404-20260826-181434.zip`;
- pre-slice SHA-256: `5E2A0BB5E1BCFFFB3D4A6A974AC73F1659E6C566346B9C3F31D417D45E1F786A`;
- isolated branch: `feat/gh0404-worker-lifecycle-v0170`;
- migrations `0001` through `0019` remain unchanged.

## Implementation evidence

Migration `0020_create_worker_lifecycle.sql` adds internal lease/output columns, lifecycle
constraints, exclusive claim, heartbeat, completion, transient/permanent failure, cancellation,
deterministic retry and bounded expired-lease recovery. `service_role` alone receives execution;
authenticated owners retain only their prior sanitized status projection.

`@green-hive/jobs` now exports `WorkerService`, `PostgresWorkerRepository`, strict runtime
validation, lease/recovery contracts and stable safe errors. Raw tokens and raw domain payloads do
not enter logs, Audit metadata or authenticated projections.

## Local gates

```text
npm ci                         PASS; 170 packages, 0 vulnerabilities
npm run db:validate            PASS; 20 immutable migrations, 23 RLS tables
npm run test:unit              PASS; 110/110
npm run db:test                PASS; 19/19
npm run db:test:supabase       PASS; native Auth/RLS/Worker matrix and clean retained baseline
local Supabase smoke           PASS; ledger=20, pending=0, REFERENCE_APP=1, job registration=1
```

The Worker matrices cover exclusive concurrent claim, exact lease ownership, heartbeat, transient
retry delay, retry exhaustion, permanent failure, completion, cancellation, expired-lease
recovery, authenticated denial and Audit secret exclusion.

## Release handoff

At the implementation commit, dedicated Supabase staging, GitHub CI, Render twenty-migration
readiness and published acceptance were still required, so this document correctly recorded
GH-0404 as `PARTIAL` at that stage. Those external gates subsequently passed and are recorded in
the [GH-0404 release validation](VALIDATION-2026-08-26-GH0404-RELEASE.md), which promotes the
checkpoint to `DONE`.
