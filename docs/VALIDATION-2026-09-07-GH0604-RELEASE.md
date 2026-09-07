# GH-0604 release validation — 2026-09-07

## Release scope

This evidence closes GH-0604 Basic In-App Notifications for coordinated platform version `0.26.0`.
The `REFERENCE_APP` product manifest remains `0.1.0`.

A job that first reaches `COMPLETED` now produces one durable `JOB_COMPLETED` notification for its
project owner. The owner can list and acknowledge that notification in the Reference App. This
release does not add email, push, polling, realtime channels, brokers, paid providers or a
continuously running notification worker.

## Evidence

- `npm run verify`: pass after a clean build, including formatting, platform/security scans,
  TypeScript, **181 unit tests**, database validation and **24 embedded PostgreSQL-compatible
  scenarios;
- immutable migration catalog: **26** migrations, **27** RLS-protected tables, canonical seed
  isolation and the `0026` SHA-256 ledger verification pass;
- dedicated native Supabase staging matrix: pass after applying `0026`; it proves one
  job-derived notification, owner acknowledgement idempotency, cross-user invisibility,
  read-only platform-admin access and absence of sensitive job/lease/file metadata;
- published staging smoke at `https://green-hive-staging.onrender.com`: liveness, database
  readiness, HTTPS/HSTS, security headers and the Reference App shell all pass;
- source manifest: regenerated and verified after the release evidence and status updates.

## Security confirmation

The trigger derives every recipient, organization, application, project, event and message from
the completed job. Browser input cannot forge any of those fields. The stored metadata contains
only the registered job type; it excludes job inputs and outputs, lease material, file identifiers,
signed URLs and secrets. `authenticated` has no insert or delete permission and can update only
its own scoped record to `READ`. Platform administrators retain operational read access only.

The staging run used only protected disposable Green Hive fixtures and restored the structural seed
state afterward. No paid or external notification provider was called.
