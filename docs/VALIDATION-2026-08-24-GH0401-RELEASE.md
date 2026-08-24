# GH-0401 release validation — 2026-08-24

## Scope and release identity

This evidence closes GH-0401 Usage/Cost Foundation for coordinated platform version `0.14.0`.
The `REFERENCE_APP` product manifest remains `0.1.0`. It records the promotion of the reviewed
implementation through GitHub CI, the dedicated Supabase staging project and the published Render
HTTPS service.

```text
feature branch: feat/gh0401-usage-cost-foundation-v0140
feature PR:     #17
feature head:   aa1091aa3ab4480075f182a0250aadfa5f53f98b
merge commit:   15c2da228ce426243296ed22f45c293c2b0ceb59
Render deploy:  dep-da697o3l550s73cd75bg
public origin:  https://green-hive-staging.onrender.com
```

Both GitHub Actions checks for PR #17 passed before merge. The `push` and `pull_request` executions
of `Verify source and embedded isolation` succeeded, the PR had no conflict with `main`, and the
merge occurred only after the dedicated staging Usage/Cost matrix passed.

## Dedicated Supabase staging

The guarded apply operation confirmed the exact project identity, healthy state and one pending
canonical migration, then applied `0017_create_usage_cost_foundation.sql` once. A second migrator
run created no duplicate, all previous checksums remained unchanged and all structural seeds were
applied twice safely.

```text
project:        green-hive-staging
project ref:    rabkyesatfuezmrrzllx
region:         sa-east-1
final state:    BASELINE_READY
ledger:         17 applied, 0 pending
test artifacts: users=0, profiles=0, projects=0, settings=0, apps=0
```

The real Supabase/PostgreSQL staging matrices passed without failure:

- RLS/database/Audit: 13/13;
- Project/Workspace Service: 10/10;
- sandbox Billing provider: 7/7;
- verified webhook concurrency and replay: 1/1;
- Entitlements: 6/6;
- Usage/Cost: 5/5.

The Usage/Cost matrix proved exact-decimal persistence, identical-retry single effect, conflicting
idempotency rejection, debit/credit aggregation, cross-user and cross-app denial, protected budget
scope, owner visibility of logical usage without monetary provider cost, platform-admin read-only
inspection and denial of authenticated writes or physical deletion.

## Published Render and HTTPS acceptance

Render automatically deployed merge commit `15c2da2` on the existing Free Blueprint service. The
deploy succeeded in 51.5 seconds without a manual deploy, plan change or infrastructure change.

The public smoke passed:

```text
liveness:            PASS
readiness:           PASS
HTTPS headers:       PASS
security headers:    PASS
Reference App shell: PASS
```

The hosted security smoke also passed: repeated authentication requests were limited, account
scope held, rate-limit headers were present, health probes remained exempt and security headers
remained active.

GH-0401 adds no browser write endpoint and exposes no raw cost route. Its accounting acceptance
therefore remains at the server-only service and native Supabase boundaries validated above. The
previous disposable authenticated HTTPS matrix remains the regression evidence for cookies, Auth,
projects, workspaces, Audit, Billing, Entitlements and cleanup; it was not repeated solely to claim
new GH-0401 behavior that is intentionally absent from HTTP.

## Recovery and deferred scope

Migration `0017` is immutable and has no destructive automatic `DOWN`. Recover with a reviewed
forward migration after exporting and verifying budgets, both event ledgers, migration-ledger
checksums and bounded `USAGE_BUDGET_CONFIGURED` Audit evidence. Never edit an applied checksum or
ledger row to hide drift.

GH-0402 atomic reserve/consume/release, no-overspend decisions and `BUDGET_EXHAUSTED` remain not
started. Real payment providers, checkout UI, Jobs, AI, Redis, remote Files and consumer-domain
execution also remain outside this release.
