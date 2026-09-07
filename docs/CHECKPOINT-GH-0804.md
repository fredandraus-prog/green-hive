# GH-0804 — Disposable local recovery proof

## Delivered implementation

- a local PowerShell entry point that prompts for the backup passphrase without echoing or storing it;
- encrypted-archive checksum verification that remains valid after the artifact moves from its
  original GitHub runner path;
- strict archive inventory and logical-dump-manifest verification before any restore command;
- a generated database initialized from a local logical dump of the official local Supabase
  PostgreSQL `17.6` system baseline, with only Green Hive schemas and disposable Auth/Storage data
  cleared before restore, and with no staging connection or write path;
- a recovery matrix for the Green Hive schema set, migration ledger, `REFERENCE_APP`, project RLS
  and known Auth foreign-key dependencies;
- guaranteed best-effort cleanup of the local temporary plaintext directory, generated database
  and in-container temporary directory.

## Security boundary

The operator downloads the private encrypted Actions artifact to their own computer and enters the
passphrase only into the local secure PowerShell prompt. The implementation neither receives nor
logs that passphrase. No recovered data is uploaded, committed, copied to GitHub Actions or sent to
Supabase. The target is a generated local database that is dropped after the proof; the existing
local Supabase service remains otherwise unchanged.

The generated database receives only the Supabase compatibility objects required by the verified
schema, including the `supabase_realtime` publication when Realtime is disabled in normal local
development and the official additive Storage versioning fields when the local CLI image lags the
hosted project. These objects disappear when the generated database is dropped.

## Acceptance evidence and release gate

**Status: DONE — a current private encrypted artifact passed the local disposable recovery proof on
2026-09-07.**

The operator received
`RECOVERY_PROOF_SUCCESS target=local-supabase-disposable-database plaintext=removed-on-cleanup`
after the encrypted-sidecar, archive inventory, logical-dump manifest and recovery matrix had
passed. Cleanup then removed the plaintext working directory and generated local database.

GH-0804 does not restore staging, create a new hosted Supabase project, enable managed
backups/PITR, restore Storage object bytes or claim a complete Auth/Storage disaster-recovery
solution.
