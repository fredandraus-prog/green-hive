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
| `0014` | forward-fix provider transitions/constraints | export and verify purchases, payments and payment Audit events before restoration |
| `0015` | forward-fix verified-event constraints/function | export and verify provider-event identities, payment state and payment Audit events before restoration |
| `0016` | forward-fix entitlement mappings/grants/functions | export and verify mappings, purchase grant snapshots and Entitlement Audit events before restoration |
| `0017` | forward-fix Usage/Cost schema and protected writers | export and verify budgets, both accounting ledgers and budget Audit evidence before restoration |
| `0018` | forward-fix Cost Guard decisions/reservations/functions | export and reconcile decisions, reservations, budgets, cost events and Cost Guard Audit evidence before restoration |
| `0019` | forward-fix job registrations, queue constraints and enqueue function | export and verify registrations, queued jobs, Audit evidence and migration ledger state before restoration |
| `0020` | forward-fix Worker lease columns, functions, constraints and Audit transitions | export and verify jobs, ensure no live leases, preserve Audit evidence and migration ledger state before restoration |
| `0021` | forward-fix AI operation constraints, functions, RLS and Audit transitions | export and reconcile operation metadata, Usage/Cost evidence, Audit evidence and migration ledger state before restoration |
| `0022` | forward-fix Search operation constraints, functions, RLS and Audit transitions | export and reconcile Search operation metadata, Cost Guard reservations, Usage/Cost evidence, Audit evidence and migration ledger state before restoration |
| `0023` | forward-fix private file metadata, lifecycle writers, RLS and grants | export and reconcile file metadata, private object inventory and migration ledger before controlled restoration |
| `0024` | forward-fix private bucket declaration, export authorization and Audit constraint | export and verify file-delivery Audit evidence and private bucket configuration before controlled restoration |

If a ledger checksum, filename or rollback description differs, deployment stops. Never edit the
ledger to hide drift. Restore the canonical migration or introduce a reviewed next-numbered
forward migration.
