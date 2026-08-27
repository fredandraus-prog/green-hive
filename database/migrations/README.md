# Migrations

The published sequence is immutable:

1. schemas, `pgcrypto` and migration ledger;
2. app registry;
3. Supabase-linked user profiles;
4. projects and lifecycle constraints;
5. project settings and composite app boundary;
6. trusted JWT helpers, grants and RLS.
7. organizations, workspace memberships and backfill-safe personal workspaces;
8. organization app installations and app-scoped memberships;
9. organization scope and composite tenant foreign keys for projects/settings;
10. trusted workspace selection, provisioning helpers and tenant-aware RLS.
11. append-only Audit events, correlation metadata, transactional capture triggers and read RLS.
12. app-scoped products and immutable-version exact-decimal prices with read-only catalog RLS.
13. tenant purchases/payments, pending purchase transaction, limited reads and purchase Audit capture.
14. trusted sandbox success/failure/full-refund transitions and payment Audit capture.
15. verified provider-event identities, idempotent webhook application and forced-RLS retention.
16. product capability mappings, project entitlement snapshots and the authoritative `can` helper.
17. project-scoped budgets plus separate append-only logical usage and monetary cost ledgers.
18. entitlement-aware atomic cost decisions, reservations, consumption and release.
19. manifest-backed job registrations and tenant-safe idempotent database queue foundation.
20. exclusive Worker leases, heartbeat, deterministic retry, terminal transitions and expired-lease recovery.
21. AI Gateway operation metadata, server-only lifecycle writers, RLS and minimized Audit transitions.

Files `0001` through `0006` remain byte-for-byte unchanged. GH-0250 is expressed only through the
next-numbered migrations `0007` through `0010`. GH-0203 is expressed only through migration
`0011`; migrations `0001` through `0010` were not edited.
GH-0301 is expressed only through migrations `0012` and `0013`; migrations `0001` through `0011`
remain unchanged.
GH-0302 is expressed only through migration `0014`; migrations `0001` through `0013` remain
unchanged.
GH-0303 is expressed only through migration `0015`; migrations `0001` through `0014` remain
unchanged.
GH-0304 is expressed only through migration `0016`; migrations `0001` through `0015` remain
unchanged.
GH-0401 is expressed only through migration `0017`; migrations `0001` through `0016` remain
unchanged.
GH-0402 is expressed only through migration `0018`; migrations `0001` through `0017` remain
unchanged. Consumption reconciles one cost event inside the same transaction.
GH-0403 is expressed only through migration `0019`; migrations `0001` through `0018` remain
unchanged.
GH-0404 is expressed only through migration `0020`; migrations `0001` through `0019` remain
unchanged. Worker processes and external brokers are not introduced by the migration.
GH-0503 is expressed only through migration `0021`; migrations `0001` through `0020` remain
unchanged. Raw prompts, inputs and outputs are not persisted, and no provider or browser route is
introduced by the migration.

Every SQL file begins with parseable migration ID, checkpoint, description and rollback strategy
metadata. `migrations.json` stores the same description and strategy plus the immutable SHA-256.

The only permitted idempotent DDL is `CREATE EXTENSION IF NOT EXISTS pgcrypto`, because extensions
may be shared with other Supabase schemas. Managed schemas and tables fail on unexpected state.
