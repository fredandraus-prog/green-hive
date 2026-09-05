# GH-0601 — Private file metadata and storage service

Status: `DONE — LOCAL, EMBEDDED AND NATIVE SUPABASE RLS GATES PASS`.

## Objective

Deliver the smallest tenant-safe foundation for private generated artifacts. This is a platform
service, not a public file product: it proves owner-only metadata access, server-owned object
lifecycle and opaque private storage identity without adding download or upload surfaces.

## Delivered scope

- typed public/safe file contracts and stable `FileError` codes in `@green-hive/files`;
- server-only File Service with runtime validation, capability checks, idempotency and compensation;
- deterministic zero-network fake storage plus a server-injected Supabase private-storage adapter;
- immutable migration `0023`, metadata/checksum ledger entry and forward-fix recovery strategy;
- `hive.files` composite project scope, opaque storage key, SHA-256 integrity fields and logical
  deletion;
- service-role-only prepare/complete/abort/delete SQL writers, empty search paths and no PUBLIC or
  authenticated execution grant;
- safe-column owner RLS with no platform-admin file read path and no authenticated direct writes;
- unit, embedded PostgreSQL-compatible and native local-Supabase tests for scope, privilege,
  idempotency, deletion, retention and absence of premature export Audit events;
- coordinated platform version `0.23.0`; the Reference App manifest remains `0.1.0`.

## Acceptance evidence

1. one owner can prepare, complete and list only its own Ready metadata in its own app/workspace;
2. a second user, the same user under another app and `PLATFORM_ADMIN` see no file rows;
3. browser-table writes, protected-column reads and lifecycle function execution are denied;
4. tenant/app/project/owner authority, storage location, status and hashes cannot be supplied by a
   consumer payload;
5. the file key is database-generated, opaque and never includes the filename;
6. active entitlement and exact app-prefixed capability are required before any private storage
   operation;
7. replaying the same request is idempotent; changed content under the same key is denied;
8. soft deletion removes the object through the service, hides it from owner reads and retains the
   `DELETED` record without granting physical table deletion;
9. no `FILE_EXPORTED` event is emitted before the GH-0602 delivery boundary;
10. migration metadata, checksum, 23-entry ledger and native Supabase RLS gate pass.

## Exclusions

No Storage bucket is activated in local/staging, no remote Storage credential is introduced, and
there is no public URL, signed URL, browser upload, arbitrary user file, malware scan, content
preview, rendering worker, CDN or external charge. Activating real private object storage remains
an explicit operational step; it must preserve the same provider/bucket allowlist and never grant
public access.

## Recovery

Migration `0023` is immutable. Recover by a reviewed forward migration. Before a controlled
restoration, export and reconcile file metadata, private-object inventory and the migration ledger.
Do not infer object keys from filenames and do not create destructive down scripts for retained
private metadata.

