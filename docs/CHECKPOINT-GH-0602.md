# GH-0602 — Signed private-file download path

Status: `DONE — IMPLEMENTATION, UNIT, EMBEDDED/NATIVE RLS AND DISPOSABLE LOCAL/STAGING STORAGE GATES PASS`.

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

The local stack starts the private Storage service without a host-published port. Its guarded native
gate uses the real server-only adapter to write one random opaque object, prove direct public read
fails, issue and read one 120-second signed URL through the complete File Service boundary, then
remove the object in a `finally` block. The identical guard passed on dedicated staging after
`0024` was applied, with no schema or user deletion. This required no paid API and no public
Storage configuration.

## Exclusions

No public URL, browser upload, arbitrary file intake, malware scan, preview, CDN/cache delivery,
generic PDF/text rendering, Worker composition or external paid service is included.
