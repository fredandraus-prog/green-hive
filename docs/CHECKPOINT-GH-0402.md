# GH-0402 — Atomic Cost Guard

Platform version: `0.15.0` release candidate.

## Outcome

GH-0402 turns the exact-decimal GH-0401 cost foundation into an entitlement-aware atomic decision
boundary. A provider operation supplies a bounded estimate and one trusted `operationId`. The
database serializes decisions on the selected budget so concurrent requests cannot spend the same
remaining capacity.

The canonical equation is enforced in one transaction:

```text
consumed_amount + reserved_amount + estimated_amount <= ceiling_amount
```

## Server-side operations

```text
reserve(context, input)
consume(context, input)
release(context, input)
```

- `reserve` checks the signed user/app/workspace/project context, the active project entitlement,
  the cost budget dimension and remaining capacity under a row lock;
- `consume` replaces the full estimate reservation with an actual amount that cannot exceed that
  estimate, and records the GH-0401 monetary cost event in the same transaction;
- `release` returns the full estimate to available capacity when a provider operation did not
  consume it.

All exact decimals cross TypeScript as strings. No command accepts organization, app or owner
authority from its payload. The functions are revoked from `PUBLIC` and `authenticated`; only the
trusted server role may execute them.

## Decision and reservation evidence

Migration `0018_create_atomic_cost_guard.sql` adds:

- append-only `hive.cost_guard_decisions`, idempotently unique by tenant/project/owner and
  `operation_id`;
- lifecycle-controlled `hive.cost_guard_reservations` with `RESERVED`, `CONSUMED` and `RELEASED`;
- `hive.reserve_project_cost(...)`;
- `hive.consume_cost_reservation(...)`;
- `hive.release_cost_reservation(...)`;
- bounded `COST_GUARD_DECIDED` Audit evidence without amounts, provider identifiers, operation IDs
  or idempotency material.

An identical reserve retry returns the original decision. Reusing the same `operationId` with a
different request fails with `COST_GUARD_IDEMPOTENCY_CONFLICT`. Identical terminal retries return
the original reservation; conflicting or opposite terminal transitions fail without changing the
budget.

## Outcomes in this checkpoint

The public contract retains all canonical Green Hive decision names. GH-0402 itself emits only:

| Outcome | Stable reason | Effect |
|---|---|---|
| `ALLOW` | `BUDGET_RESERVED` | exact estimate is reserved |
| `DENY_ENTITLEMENT` | `ENTITLEMENT_REQUIRED` | no reservation or budget mutation |
| `DENY_BUDGET` | `BUDGET_EXHAUSTED` | no reservation or budget mutation |

`ALLOW_CACHED`, `ALLOW_CHEAPER_PROVIDER`, `ALLOW_REDUCED_CONTEXT` and `ALLOW_REDUCED_SCOPE` remain
typed future routing outcomes. They require a real AI/Search/provider gateway and are not selected
by this database-only decision service.

## Deliberate boundaries

GH-0402 does not estimate provider prices, select providers, execute AI/Search, create jobs, use
Redis, expose a browser write endpoint or weaken authentication, authorization and correctness.
Provider-specific estimation must produce a bounded exact-decimal amount before calling `reserve`.

## Recovery

Migration `0018` is immutable after publication. Prefer a reviewed forward fix. Before controlled
restoration, export and reconcile decisions, reservations, usage budgets, monetary cost events,
Audit evidence and the migration ledger. Outstanding `RESERVED` rows must be resolved explicitly;
they must never be silently discarded from a live environment.
