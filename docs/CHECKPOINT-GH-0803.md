# GH-0803 — Automated backups

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

**Status: DONE — the first encrypted staging backup and private artifact observation completed.**

The release gate completed on 2026-09-07 through [manual workflow run #3](https://github.com/fredandraus-prog/green-hive/actions/runs/34156714551):

- `BACKUP_SUCCESS` was published in the GitHub Actions job summary;
- roles, schema and data manifest hashes passed before encryption;
- plaintext dumps were removed before the artifact upload;
- exactly one encrypted private artifact was produced, with 54 KB and the recorded artifact digest
  `sha256:d13275b89c0562cf77185c9788ca7b400828d1f3d4019327f21e52bf82e7dc4f`;
- the artifact retention boundary is one day.

The run emitted a non-blocking GitHub Actions deprecation warning because upstream
`actions/upload-artifact@v4` and `supabase/setup-cli@v1` still target Node.js 20 internally; GitHub
forced them to Node.js 24 and the full run passed. Track upstream action upgrades before the runtime
support deadline, without changing the tested backup path opportunistically.

No live dump was created while the workflow was initially implemented. That was intentional: a
database export is customer/platform data, and it began only after the dedicated GitHub secrets and
one-day retention boundary were intentionally configured. GH-0804 remains the separate
disposable-target restore proof.

This checkpoint does not activate Supabase managed backups, PITR, a paid storage service, storage
object replication, a production restore or a new database migration.
