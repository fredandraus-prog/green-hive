# GH-0402 release validation — 2026-08-24

## Scope and release identity

This evidence closes GH-0402 Atomic Cost Guard for coordinated platform version `0.15.0`. The
`REFERENCE_APP` product manifest remains `0.1.0`. It records promotion through GitHub CI, dedicated
Supabase staging and the existing Free-plan Render HTTPS service.

```text
feature branch:       feat/gh0402-atomic-cost-guard-v0150
feature PR:           #19
feature head:         25a791af83e48bb6c745887159e8c3b43cbe750a
feature merge:        91e0fcf4ce3d4db01b0543a8385b75fabdfb91f1
readiness branch:     fix/gh0402-hosted-readiness-v0150
readiness PR:         #20
readiness head:       b8f859d2431d0d8a59a824d54f27a856f6990bd8
release source:       325a7a4430ebbcb604fe89a04abe98ab0fc61647
successful deploy:    dep-da6djmbncjis738915rg
public origin:        https://green-hive-staging.onrender.com
```

Both `push` and `pull_request` executions of `Verify source and embedded isolation` passed for PR
#19 before its merge. The same two checks passed for the minimal readiness PR #20, and the
post-merge `main` check passed on commit `325a7a4`. Both PRs were conflict-free.

## Dedicated Supabase staging

The guarded apply operation confirmed the exact project identity and applied only canonical
migration `0018_create_atomic_cost_guard.sql`. Reapplication created no duplicate, previous
checksums remained unchanged and structural seeds were applied twice safely.

```text
project:        green-hive-staging
project ref:    rabkyesatfuezmrrzllx
region:         sa-east-1
final state:    ACTIVE_HEALTHY / BASELINE_READY
ledger:         18 applied, 0 pending
test artifacts: users=0, profiles=0, projects=0, settings=0, apps=0
```

The final complete clean staging run passed:

- RLS/database/Audit: 13/13;
- Project/Workspace Service: 10/10;
- sandbox Billing provider: 7/7;
- verified webhook concurrency and replay: 1/1;
- Entitlements: 6/6;
- Usage/Cost: 5/5;
- Atomic Cost Guard: 5/5.

The first staging test attempt had a transient failure in the unchanged GH-0303 concurrent webhook
test. It was not used as acceptance evidence. The complete retry above passed without failure and
left no disposable artifacts.

The Cost Guard native matrix used separate PostgreSQL connections. Simultaneous estimates of
`6.000000` against a `10.000000` ceiling produced exactly one `ALLOW` and one `DENY_BUDGET`, so
reserved plus consumed cost never crossed the budget. It also proved entitlement-first denial,
exact replay, conflicting-operation rejection, terminal consume/release behavior, atomic GH-0401
cost evidence, cross-scope denial, read-only administration and denial of authenticated direct
writes/function execution.

## Render deployment and correction

Render automatically attempted feature merge `91e0fcf` as deploy
`dep-da6dfcegekts739ch9m0`. It failed after 48.4 seconds because the application still required an
exact 17-migration readiness baseline while staging correctly contained 18. The service became
temporarily unavailable. No migration was edited or reverted, no schema was dropped and no manual
deploy, plan change or infrastructure change was used to hide the mismatch.

Readiness hotfix `b8f859d` changed only the readiness contract, its unit fixture and the release
manifest. It requires migration 18 and explicitly checks both Cost Guard tables plus the reserve,
consume and release functions. The full local gate passed again: 104 unit tests, 17 embedded
database tests, 18 immutable migrations, 21 RLS-protected tables, build and security smoke.

Render automatically published hotfix merge `325a7a4` as deploy
`dep-da6djmbncjis738915rg` in 54.4 seconds. The Render dashboard reports `Deploy succeeded`.

The exact HTTPS public smoke passed:

```text
liveness:            PASS
readiness:           PASS
HTTPS headers:       PASS
security headers:    PASS
Reference App shell: PASS
```

The hosted security smoke also passed: repeated Auth requests were limited, account scope held,
rate-limit headers were present, health/readiness probes remained exempt and security headers
remained active.

## Recovery and deferred scope

Migration `0018` is immutable and has no destructive automatic `DOWN`. Recover with a reviewed
forward migration after exporting and verifying decisions, reservations, budgets, cost events,
Audit evidence and the migration ledger. Never edit an applied checksum or ledger row to hide
drift.

GH-0403 Jobs remains not started. Provider price lookup/estimation, provider selection, real
providers, AI, Search execution, Redis, remote Files, new external webhooks and consumer-domain
execution remain outside version `0.15.0`.

