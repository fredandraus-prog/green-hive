# GH-0803 — Automated backup configuration

## Delivered implementation

- a daily/manual GitHub Actions workflow that uses the pinned `supabase` CLI `2.115.0` to create
  the documented roles, schema and data logical dumps;
- a strict manifest writer/verifier that rejects missing, empty or changed dumps before recovery;
- AES-256-CBC + PBKDF2 encryption before the only artifact upload;
- one-day artifact retention, read-only repository permissions and removal of plaintext dumps before
  upload;
- documentation of the secret boundary, coverage boundary and recovery handoff.

## Security boundary

The workflow accepts its database connection and encryption passphrase only from repository
Actions secrets. Neither secret is emitted to output, committed, passed through workflow inputs or
available to the browser. Artifacts contain only the encrypted archive plus its encrypted-archive
checksum. The backup job cannot write to the repository.

## Release gate

**Status: PARTIAL — implementation complete; first encrypted staging backup and artifact observation
pending.**

No live dump was created while implementing this slice. That is intentional: a database export is
customer/platform data, and it must not begin until the dedicated GitHub secrets and retention
boundary are intentionally configured. The checkpoint becomes `DONE` only after a manual run
produces one `BACKUP_SUCCESS` summary, encrypted artifact and checksum, followed by GH-0804's
separate disposable-target restore proof.

This checkpoint does not activate Supabase managed backups, PITR, a paid storage service, storage
object replication, a production restore or a new database migration.
