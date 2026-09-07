# GH-0603 release validation — 2026-09-07

## Release scope

This evidence closes GH-0603 Private Document Rendering Worker for coordinated platform version
`0.25.0`. The `REFERENCE_APP` product manifest remains `0.1.0`.

The release adds deterministic local TEXT/PDF rendering, a private-file lifecycle derived only from
an active worker lease, and one Reference App processor for the registered
`REFERENCE_APP_RENDER_PROJECT_DOCUMENT` job. No real AI, paid provider, browser upload, public
Storage, remote template, recurring worker daemon or Redis service is included.

## Evidence

- clean `npm ci`: 149 packages installed; production dependency audit found `0` vulnerabilities;
- `npm run verify`: pass after a clean build, including formatting, platform/security scans,
  TypeScript, **179 unit tests**, database validation and **24 embedded PostgreSQL-compatible
  scenarios;
- immutable migration catalog: **25** migrations, **26** RLS-protected tables, canonical seed
  isolation and `0025` SHA-256 verification pass;
- dedicated Supabase staging preflight: healthy project, 24 applied migrations, exactly one pending
  migration and zero disposable test artifacts before application;
- guarded staging apply: only `0025_create_worker_rendered_files.sql` applied, structural seeds
  replayed, ledger `25`, and no schema or user deletion;
- guarded native staging matrix: pass, including the expanded Files path that proves authenticated
  callers cannot execute worker helpers; the service role can claim the registered job, create one
  opaque private file under the exact lease, complete it and finish the job;
- source manifest: generated and verified after all release documentation changes;
- extracted release package: checksum/inventory verified, no dependency directory, build output,
  `.env`, Git metadata, log, temporary file or absolute path entry; clean `npm ci` and full
  `npm run verify` pass on the extracted copy.

## Security confirmation

The worker file helpers accept no tenant, owner, application, project, file ID, storage key,
capability or entitlement authority from a request. They verify the active job's lease identity and
derive the file scope in PostgreSQL. `PUBLIC` and `authenticated` lack execution permission. The
first deterministic PDF path accepts only printable ASCII after bounded validation, and failed
write/completion paths compensate the processing metadata and private object in the safe order.

The dedicated staging execution used only the existing protected project configuration. It did not
invoke an OpenAI endpoint or any service that may cause a charge.
