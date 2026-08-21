# Bootstrap reconciliation - 2026-08-18

## Material found

The canonical project directory contained both the original GH-1 bootstrap material and the later
GH-0102/GH-0103 overlay. The original `MANIFEST.csv` lists 91 bootstrap files and is preserved
unchanged as provenance evidence.

Comparison before reconciliation found:

- 91 original manifest entries still present;
- 53 original files byte-identical to their recorded hashes;
- 38 original files changed by the overlay;
- 0 original manifest files missing;
- 41 additional files outside the original bootstrap inventory;
- 133 source files in total when `MANIFEST.csv` itself is included.

The exact former bytes of the 38 overwritten files were not recoverable elsewhere in the project.
This reconciliation therefore restores canonical behavior and package contracts from surviving
sources and Platform 1.0, without claiming byte-for-byte restoration.

## Preservation evidence

Before any reconciliation, a source-only backup was created:

```text
backups/green-hive-pre-reconcile-20260818-204408.zip
SHA-256: 28BE0110B2D47BEA7D5DAD75276DEA9678E5E159AB600B7DFC514ECC34A4C675
Entries: 133
```

The backup excludes installed dependencies, generated `dist`, caches, logs and `.env`. The
Platform 1.0 specification, Beesness and Apps Ideas directories were used only as references and
were not modified.

## Reconciliation decisions

- restored `@green-hive/core` as the only App Manifest authority;
- retained exactly the 18 canonical platform packages;
- removed the parallel `app-contract`, `config`, `storage` and `testing` workspaces after backup;
- preserved `MANIFEST.csv` as the immutable GH-1 baseline;
- generated a new release SHA-256 manifest for the reconciled source tree.
