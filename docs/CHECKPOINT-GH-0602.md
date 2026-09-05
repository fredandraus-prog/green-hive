# GH-0602 — Signed private-file download path

Status: `PARTIAL — IMPLEMENTATION, UNIT AND EMBEDDED RLS GATES PASS; NATIVE SUPABASE STORAGE ACTIVATION PENDING`.

## Objective

Deliver the smallest private download path for generated artifacts without creating an upload API,
a public bucket or a browser storage authority.

## Delivered scope

- `FileService.createDownload(context, projectId, fileId)` with fixed server-owned 60–300 second
  lifetime configuration;
- opaque bounded `FileDownloadGrant` containing only `url` and `expiresAt`;
- `PrivateStorageProvider.createSignedDownload(...)`, implemented by deterministic fake storage and
  the injected Supabase private-storage adapter;
- immutable migration `0024` declaring `green-hive-generated` as private and adding the
  service-role-only `hive.record_file_export(uuid, uuid)` writer;
- `FILE_EXPORTED` Audit evidence with file subject identity plus byte size, MIME type and
  sensitivity only; no URL, token, key, bucket, credential or content is recorded;
- unit and embedded PostgreSQL-compatible coverage for owner success, cross-user/app/admin denial,
  deleted-file denial, no authenticated execution grant and safe audit metadata.

## Remaining operational gate

The local stack now starts the private Storage service without a host-published port and the native
database gate verifies the private bucket, migration, RLS and writer grants. The remaining release
gate must use a server-owned Storage client to write one disposable object, verify its short signed
URL and clean the object/fixture on local Supabase and then staging. This requires no paid API and
no public Storage configuration.

## Exclusions

No public URL, browser upload, arbitrary file intake, malware scan, preview, CDN/cache delivery,
generic PDF/text rendering, Worker composition or external paid service is included.
