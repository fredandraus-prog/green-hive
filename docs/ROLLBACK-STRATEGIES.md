# Migration recovery strategies

Rollback metadata is mandatory, but destructive automatic `DOWN` scripts are intentionally absent.
Once real data exists, a reviewed forward correction is normally safer.

| Migration | Preferred recovery | Destructive fallback |
|---|---|---|
| `0001` | restore the pre-deployment snapshot | remove managed schemas only in an empty disposable database |
| `0002` | forward-fix registry constraints | drop `apps` only before dependent data exists |
| `0003` | forward-fix profile shape | restore a verified profile backup before removal |
| `0004` | forward-fix projects | export and verify projects/settings before removal |
| `0005` | forward-fix settings | restore verified settings before removal |
| `0006` | forward policy correction | revoke affected grants during controlled maintenance |
| `0007` | forward-fix organization/member constraints | restore verified tenant exports before controlled removal |
| `0008` | forward-fix app-installation roles | restore verified installation/member exports |
| `0009` | forward-fix tenant scope | restore the verified project-to-organization mapping |
| `0010` | forward tenant-policy correction | revoke affected organization grants during controlled maintenance |
| `0011` | forward-fix event constraints/triggers | export and verify events before disabling only the affected capture trigger |
| `0012` | forward-fix catalog constraints/policies | export and verify every product and versioned price before restoration |
| `0013` | forward-fix commercial ledger/function | export and verify purchases, payments, snapshots and Audit events before restoration |

If a ledger checksum, filename or rollback description differs, deployment stops. Never edit the
ledger to hide drift. Restore the canonical migration or introduce a reviewed next-numbered
forward migration.
