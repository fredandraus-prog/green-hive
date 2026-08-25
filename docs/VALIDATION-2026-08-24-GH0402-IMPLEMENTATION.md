# GH-0402 implementation validation — 2026-08-24

## Result

GH-0402 Atomic Cost Guard is `DONE` at the implementation and database-parity boundary.

Platform packages are coordinated at `0.15.0`. The canonical `REFERENCE_APP` product manifest
remains `0.1.0`; this checkpoint changes platform infrastructure and does not release a new
Reference App product contract.

The `0.15.0` application has not yet been merged into `main` or deployed to Render. Hosted database
parity is complete, while the public application deployment remains a post-review release action.
The subsequent promotion and hosted-readiness correction are recorded separately in
`VALIDATION-2026-08-24-GH0402-RELEASE.md` so this implementation snapshot remains factual.

## Preservation and working branch

- canonical starting commit: `6e992b1dbd30f0c54efda009add9f98162e9977c`;
- implementation branch: `feat/gh0402-atomic-cost-guard-v0150`;
- dedicated worktree:
  `Engine/worktrees/green-hive-gh0402-cost-guard`;
- source-only pre-slice backup:
  `Engine/backups/green-hive-v0.14.0-pre-gh0402-20260824-182854.zip`;
- backup SHA-256:
  `33D35078F0563C40ED9E1AB70919900E640500780D0D2F6976DAE93D577C54A5`;
- sidecar: `green-hive-v0.14.0-pre-gh0402-20260824-182854.zip.sha256`.

The backup excludes installed dependencies, build outputs, caches and secrets. Existing immutable
migrations `0001` through `0017` were not edited.

## Implemented boundary

Migration `0018_create_atomic_cost_guard.sql` adds:

- append-only `hive.cost_guard_decisions`;
- lifecycle-constrained `hive.cost_guard_reservations`;
- `hive.reserve_project_cost(...)`;
- `hive.consume_cost_reservation(...)`;
- `hive.release_cost_reservation(...)`;
- forced RLS, limited read columns and server-only write/function grants;
- bounded `COST_GUARD_DECIDED` Audit capture.

The migration registry records checksum
`c1519e3feb5ead0642422dbbbb879802a0ab0c7170547ba960e8276615eb5f6d`.
Recovery metadata requires a new forward-fix migration; no destructive `DOWN` migration was added.

The public TypeScript surface now includes canonical Cost Guard decisions, reservations, runtime
validation, stable errors, a PostgreSQL repository and `CostGuardService.reserve`, `consume` and
`release` commands. Consumer inputs cannot supply user, app, workspace, owner or budget authority.

## Decision and accounting guarantees

The reserve transaction repeats trusted user/app/workspace/project scope, verifies the requested
capability through `hive.can_project_capability(...)`, locks the selected cost budget and evaluates:

```text
consumed_cost + reserved_cost + estimated_request_cost <= cost_ceiling
```

The transaction persists one of the implemented outcomes:

- `ALLOW` with reason `BUDGET_RESERVED`;
- `DENY_ENTITLEMENT` with reason `ENTITLEMENT_REQUIRED`;
- `DENY_BUDGET` with stable reason `BUDGET_EXHAUSTED`.

Exact operation replay returns the stored decision. Reuse of the same operation identity with a
different fingerprint fails closed. Consumption replaces the full estimate with the bounded actual
cost and writes the GH-0401 monetary cost event in the same transaction. Release returns the full
estimate without creating a cost event. `RESERVED -> CONSUMED` and `RESERVED -> RELEASED` are the
only terminal transitions, and exact terminal replay is idempotent.

## Security evidence

- only `auth.uid()` and signed `app_metadata` helpers supply user/app/platform role;
- the selected workspace is the validated trusted tenant context already established by GH-0256;
- `user_metadata`, headers, query strings, form fields and client configuration grant no authority;
- project ownership, app, workspace and active-project state are repeated in PostgreSQL;
- entitlement is checked before a budget can be reserved;
- authenticated users cannot insert, update or delete Cost Guard rows directly;
- authenticated users cannot execute reserve, consume or release functions directly;
- platform administrators have bounded read-only inspection and cannot reuse owner commands;
- owner reads omit actual consumed cost and all direct writes remain unavailable;
- Audit metadata excludes estimated/actual cost, provider identity, operation IDs, idempotency
  material, credentials and consumer payloads.

## Local validation

The following clean local gates passed:

- clean dependency installation: 149 packages, zero known vulnerabilities at installation time;
- formatting, lint, package-boundary lint and security scan;
- TypeScript typecheck and package-local build;
- unit tests: 104 passed, 0 failed;
- embedded database tests: 17 passed, 0 failed;
- database validation: 18 immutable sequential migrations and 21 forced-RLS tables;
- complete `npm run verify` gate;
- dependency audit at the configured high-severity threshold.

The native local Supabase gate passed with Docker `29.7.2`, native Supabase Auth and PostgreSQL:

- migrations `0001` through `0018` applied and reapplied without duplication;
- all 18 ledger checksums validated;
- structural seeds applied twice;
- database/RLS matrix: 13 passed;
- Project/Workspace Service: 10 passed;
- Billing Service/provider: 7 passed;
- verified webhook: 1 passed;
- Entitlements: 6 passed;
- Usage/Cost: 5 passed;
- Atomic Cost Guard: 5 passed.

The Cost Guard native test uses independent PostgreSQL connections for simultaneous estimates. Two
requests of `6.000000` against one `10.000000` ceiling produced exactly one `ALLOW` and one
`DENY_BUDGET`, proving that the total reservation never crossed the ceiling.

## Dedicated Supabase staging validation

The guarded staging preflight initially found 17 applied migrations, one canonical pending
migration and zero disposable test artifacts. The apply operation added only immutable migration
`0018`, reapplied the migrator without duplication, applied structural seeds twice and retained the
managed schemas.

The first full staging test attempt encountered a transient failure in the pre-existing GH-0303
concurrent webhook test (`BILLING_WEBHOOK_PROCESSING_FAILED`). GH-0402 was not the failing test, and
the unchanged GH-0303 test had already passed locally. No result from that interrupted attempt was
used as final acceptance evidence.

One complete clean retry then passed:

- database/RLS matrix: 13 passed, 0 failed;
- Project/Workspace Service: 10 passed, 0 failed;
- Billing Service/provider: 7 passed, 0 failed;
- verified webhook concurrency/replay: 1 passed, 0 failed;
- Entitlements: 6 passed, 0 failed;
- Usage/Cost: 5 passed, 0 failed;
- Atomic Cost Guard: 5 passed, 0 failed, including separate-connection concurrency.

The final preflight reported `ACTIVE_HEALTHY`, 18 applied migrations, zero pending migrations and
zero disposable users, profiles, projects, settings or app fixtures. The structural
`REFERENCE_APP`, sandbox catalog and entitlement mappings remain intact.

## Deliberately excluded

GH-0402 does not add provider price lookup or estimation, provider selection, real provider calls,
Jobs, AI execution, Search execution, Redis, remote Files, external webhooks or consumer-domain
behavior. The additional canonical decision names remain public contract values but are not emitted
by this slice. GH-0403 Jobs is the next checkpoint.
