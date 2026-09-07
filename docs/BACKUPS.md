# Backups and recovery boundary

## Current objective

GH-0803 provides an automated, encrypted **logical database backup** workflow for the hosted
staging project. It is deliberately inactive until its two GitHub repository secrets are set. A
missing secret fails before any database connection or dump command runs.

The workflow is source-controlled, but it never commits a database dump. On a successful run it:

1. creates separate `roles.sql`, `schema.sql` and `data.sql` dumps with the pinned Supabase CLI;
2. calculates and verifies SHA-256 evidence for those three files;
3. packs the dumps and manifest, encrypts the archive with AES-256-CBC plus PBKDF2, and removes
   every plaintext dump before upload;
4. uploads only the encrypted archive and its SHA-256 checksum as a private GitHub Actions
   artifact with one-day retention;
5. publishes the safe `BACKUP_SUCCESS` result in the workflow summary.

The scheduled run is daily at `03:23 UTC`. A manual run is also available in GitHub Actions. The
backup has `contents: read` only; it cannot commit artifacts, change the application, or change
repository secrets.

## Required one-time repository configuration

Set these **repository Actions secrets** in the private Green Hive GitHub repository. Never place
either value in a file, issue, pull request, workflow input or application environment variable.

| Secret | Value | Purpose |
|---|---|---|
| `GREEN_HIVE_BACKUP_DATABASE_URL` | The staging Supabase **Session pooler** PostgreSQL connection URI, with the database password URL-encoded when necessary | Lets the backup runner create a database-only dump through the documented IPv4-friendly connection. |
| `GREEN_HIVE_BACKUP_PASSPHRASE` | A new random passphrase of at least 32 characters, kept separately from the repository | Encrypts the archive before it becomes an Actions artifact. |

The existing `DATABASE_URL` used by Render must not be copied into application source or browser
configuration. It is acceptable to reuse its connection identity only by storing the complete
value under the dedicated backup secret above.

After the secrets exist, run **Green Hive encrypted database backup** once manually from GitHub
Actions. The green job, `BACKUP_SUCCESS` summary and encrypted artifact are the acceptance evidence
for the automated-backup part of GH-0803. A failed job must be investigated; a schedule alone is
not evidence of a usable backup.

## Scope and limitations

This workflow covers the PostgreSQL logical database state only. It does not claim to copy Storage
objects, Render configuration, GitHub/Render/Supabase secrets, Mailtrap configuration, or OpenAI
credentials. Supabase documents that database backups do not include objects stored through the
Storage API; `storage.objects` metadata is not a substitute for the private object bytes.

The current platform has private generated-file Storage capability, so a separate encrypted
object-storage copy and recovery proof must be designed before claiming a complete platform
disaster-recovery guarantee. That work is outside this database-first GH-0803 implementation and
will be recorded explicitly if/when a storage destination is selected.

Supabase Free does not include managed automatic backups or Point-in-Time Recovery. The free-tier
path here follows Supabase's documented CLI-dump recommendation and retains a short, encrypted,
off-service copy. Managed daily backups and PITR remain a future paid decision; neither is enabled
by this repository.

## Verify and recover an artifact

Recovery is never performed against the live staging project. GH-0804 will use a separate,
disposable recovery target and record the result.

1. Download the encrypted artifact and its `.sha256` sidecar from the successful private Actions
   run.
2. Verify the encrypted file checksum before decrypting it.
3. Decrypt the archive with the separately retained backup passphrase, then unpack it in a secure,
   temporary directory outside the repository.
4. Run `node scripts/backup-artifact.mjs verify <dump-directory> <manifest-path>`; it must emit
   `BACKUP_MANIFEST_VERIFIED`.
5. Restore only into the approved recovery target using the documented Supabase CLI/`psql` process,
   then execute the GH-0804 recovery matrix.
6. Remove the temporary plaintext directory when validation is finished.

Do not restore into a project that still contains data to preserve. A restore makes the target
inaccessible while it runs and must be treated as a controlled change.

## Why the workflow uses separate dumps

Supabase documents logical backup/restoration as separate roles, schema and data dumps. Keeping the
files distinct makes the structure inspectable during GH-0804 and lets the manifest detect a
partial or altered dump before any restore command is considered. The archive contains no custom
Green Hive migration edits: immutable migrations remain the deploy path; backup recovery is a
recovery path, not a way to bypass the migration ledger.
