# GH-0401 — Usage/Cost Foundation

Status: `DONE` in platform `0.14.0`.

## Outcome

GH-0401 establishes project-scoped accounting evidence without implementing a Cost Guard decision.
It adds exact-decimal budgets, logical usage events and monetary cost events as three deliberately
separate records. Events and budgets persist with organization, app, project and owner scope.

The checkpoint is complete because the immutable migration, TypeScript service, RLS/grants,
idempotency behavior, Audit boundary and cleanup passed in the embedded database, local Supabase
and the dedicated Supabase staging project.

## Delivered

- migration `0017_create_usage_cost_foundation.sql`;
- `hive.usage_budgets`, `hive.usage_events` and `hive.cost_events`;
- exact `numeric(24, 8)` values exposed to TypeScript only as strings;
- SHA-256 idempotency keys and canonical operation fingerprints;
- server-only `configure_usage_budget`, `record_usage_event` and `record_cost_event` functions;
- owner-limited budget and logical-usage reads;
- platform-admin operational reads with no write command;
- raw monetary-cost isolation from project owners;
- append-only accounting rows and no authenticated physical delete;
- `USAGE_BUDGET_CONFIGURED` Audit evidence with bounded metadata;
- `@green-hive/cost-guard` GH-0401 contracts, validation, service and PostgreSQL repository;
- protected Reference App server readers for budgets, logical events and summaries;
- unit, embedded PostgreSQL-compatible and native Supabase matrices.

## Canonical budget types

```text
AI
SEARCH
DOCUMENT
FILE_PROCESSING
TOTAL_COST
SAFETY_RESERVE
```

Every budget declares a measurement kind (`USAGE` or `COST`) and a unit. Cost units are three-letter
currency codes. `cycle_id` and a bounded time period are optional.

## Trust boundary

No input accepts `organization_id`, `app_id` or `owner_user_id`. Those values are derived from:

```text
auth.uid()
auth.jwt().app_metadata.app_code
validated request.green_hive.organization_id
owned and accessible hive.projects row
```

The privileged SQL functions repeat that authority check even when invoked through a connection
capable of bypassing RLS. Authenticated clients cannot execute the functions or write the tables.

## Deliberate GH-0402 boundary

`consumed_amount` and `reserved_amount` are constrained foundation columns and remain zero in
GH-0401. This checkpoint does not:

- reserve budget;
- approve or deny an operation;
- consume or release a reservation;
- emit `BUDGET_EXHAUSTED`;
- guarantee concurrent no-overspend behavior;
- select a cheaper provider or reduce scope/context.

Those atomic decisions belong exclusively to GH-0402. Migration `0017` must remain immutable;
GH-0402 will use a new next-numbered migration.

## Recovery

There is no destructive automatic `DOWN`. Prefer a reviewed forward migration. Before any
controlled restoration, export and verify budgets, both event ledgers, migration ledger evidence
and `USAGE_BUDGET_CONFIGURED` Audit rows. Never edit the `0017` checksum or migration record to
hide drift.

