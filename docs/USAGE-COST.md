# Usage and cost accounting

## Purpose

GH-0401 records what a project used and what that operation cost without treating those facts as
the same thing:

- a `usage_event` represents logical consumption, such as tokens, documents or searches;
- a `cost_event` represents an exact monetary cost charged by a provider or platform service;
- a `usage_budget` records an approved ceiling and scope but makes no runtime decision yet.

This separation prevents provider pricing from becoming the product usage model and allows future
Cost Guard decisions to use both forms of evidence.

## Data model

### `hive.usage_budgets`

Budgets are scoped by organization, app, project and owner through a composite foreign key. Each
row contains:

- canonical budget type;
- measurement kind (`USAGE` or `COST`);
- uppercase unit or ISO-style currency code;
- exact-decimal ceiling;
- optional cycle and period;
- `ACTIVE` or `CLOSED` status;
- bounded non-confidential metadata;
- hashed idempotency key and configuration fingerprint.

The natural project/type/kind/unit/cycle dimension is unique. Identical retries return the original
row; a conflicting reuse fails with `USAGE_COST_IDEMPOTENCY_CONFLICT`.

### `hive.usage_events`

Logical usage is append-only. A row records a debit or credit, exact quantity, usage code, unit,
operation identity, optional budget/capability/cycle/provider/service context and bounded metadata.
An optional budget must belong to the same project scope, be active, use `USAGE` measurement and
match the event unit.

The owner-visible summary is computed from immutable evidence:

```text
net quantity = sum(DEBIT quantity) - sum(CREDIT quantity)
```

This aggregation does not mutate the budget and is not a Cost Guard consume operation.

### `hive.cost_events`

Monetary costs are also append-only, but remain separate and use an exact amount plus currency,
provider, service, optional model and cycle. An optional budget must use `COST` measurement and the
same currency. Project owners have no RLS path to raw cost rows. Platform administration can inspect
operational rows but cannot create, update or delete them as an authenticated administrator.

## TypeScript boundary

`@green-hive/cost-guard` exports:

- `UsageBudget`, `UsageEvent`, `CostEvent` and `UsageSummary`;
- canonical budget, measurement and event-kind constants;
- inputs that never contain owner/app/organization authority;
- `UsageCostService` and `PostgresUsageCostRepository`;
- stable sanitized errors.

All PostgreSQL numerics cross the TypeScript boundary as strings. Converting accounting values to
JavaScript `number` is prohibited because binary floating-point would lose decimal exactness.

## Service operations

```text
configureBudget(context, input)
recordUsage(context, input)
recordCost(context, input)
listBudgets(context, projectId)
listUsageEvents(context, projectId)
summarizeUsage(context, projectId)
```

The three write operations are internal server operations. Their SQL functions are revoked from
`PUBLIC` and `authenticated` and granted only to the Supabase `service_role` when that role exists.
The service also verifies that the signed session context and SQL helpers agree and rejects reuse of
owner commands by `PLATFORM_ADMIN`.

The Reference App server integrates only the three owner-safe read operations. It publishes no raw
cost reader and no browser accounting write endpoint in this checkpoint.

## RLS matrix

| Table | Project owner | Platform admin | Direct authenticated write |
|---|---|---|---|
| `usage_budgets` | own project/app/workspace, limited columns | read | none |
| `usage_events` | own project/app/workspace, safe columns | read | none |
| `cost_events` | no rows | read | none |

All three tables use enabled and forced RLS. There are no authenticated `DELETE` policies or table
write grants. Hash/fingerprint columns are not granted to authenticated reads.

## Audit and confidential data

Budget configuration creates one `USAGE_BUDGET_CONFIGURED` event with only budget type,
measurement kind, unit and status. Individual usage and cost rows are already accounting ledgers
and are not duplicated into `audit.events`.

Metadata is object-shaped, size-bounded and rejects credential/content keys such as `token`,
`secret`, `authorization`, `cookie`, `password`, `prompt`, `document`, `payload` and `signature`.
No prompts, document contents, raw provider payloads, credentials or idempotency keys belong in
accounting or Audit metadata.

## GH-0402 handoff

The next checkpoint will implement the canonical equation atomically:

```text
used_cost + estimated_request_cost + reserved_future_cost
<= project_or_cycle_cost_ceiling
```

Only GH-0402 may add reserve/consume/release lifecycle operations, allow/deny decisions and the
concurrent no-overspend gate. It must extend the schema with a new immutable migration.

