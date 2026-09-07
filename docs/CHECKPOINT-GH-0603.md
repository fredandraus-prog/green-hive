# GH-0603 — Private document rendering worker

Status: `DONE — IMPLEMENTATION, UNIT, EMBEDDED DATABASE AND DEDICATED NATIVE SUPABASE STAGING MATRICES PASS`.

## Objective

Create the smallest deterministic PDF/text rendering path that can be executed only after a trusted
worker has claimed the exact registered Reference App job. The output remains a private generated
file and the completed job retains only an opaque `file:<uuid>` reference.

## Delivered scope

- deterministic, network-free `renderDocument(...)` for bounded TEXT and printable-ASCII PDF
  documents; it does not read templates, URLs, files or browser input;
- `REFERENCE_APP_RENDER_PROJECT_DOCUMENT` registration, requiring the already reviewed
  `REFERENCE_APP_GENERATE_FILE` capability;
- immutable migration `0025`, with service-role-only prepare, complete and compensation helpers;
- a worker file lifecycle derived from the active job lease, not from owner, app, organization,
  project, Storage key, file identifier or entitlement values supplied by a consumer;
- explicit compensation: a failed object write removes the `PROCESSING` row; a failed database
  completion removes the just-written private object before removing the processing row;
- a one-job Reference App processor accepting only `render:text` and `render:pdf`, then writing an
  opaque output reference after the private file is ready.

## Security boundary

`authenticated` and `PUBLIC` cannot invoke the worker-file helpers. The helper derives tenant and
owner scope from the currently `RUNNING` job, then verifies worker ID, token digest, expiry,
registered type, handler ownership and project capability. It has no browser route, recurring
daemon, public bucket, upload feature, template fetch, external rendering service or paid API.

The deterministic PDF generator permits only printable ASCII after validation. This makes the
minimal Helvetica stream predictable and prevents control/bidirectional character surprises in this
first rendering slice. Internationalized/layout-rich documents are deliberately future work.

## Completion gate

The native guarded Supabase matrix verifies migration `0025`, service-role-only worker helpers and a
complete queued-job/private-file lifecycle. The dedicated staging project completed the matrix after
applying only the pending migration and structural seed, with no schema/user reset and no remaining
test fixtures. No OpenAI key, provider call or charge was required.
