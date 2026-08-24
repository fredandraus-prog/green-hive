# GH-0304 release validation - 2026-08-24

## Scope and release identity

This evidence closes GH-0304 Entitlements for coordinated platform version `0.13.0`. The
`REFERENCE_APP` product manifest remains `0.1.0`. It records the promotion of the reviewed
implementation from local parity through the dedicated Supabase staging project and the published
Render HTTPS service.

```text
feature branch: feat/gh0304-entitlements-v0130
feature PR:     #15
feature head:   750319ecab789feacdadb913297db0b9a092f7f1
merge commit:   99a1015db4e08b080c485a2a00d95d8992d2d34d
Render deploy:  dep-da5r8unavr4c73fb9tq0
public origin:  https://green-hive-staging.onrender.com
```

Both GitHub Actions suites for PR #15 passed before merge: the push and `pull_request` executions
of `Verify source and embedded isolation` succeeded. The PR had no conflicts and was merged only
after the dedicated staging database matrix passed.

## Dedicated Supabase staging

The guarded apply operation confirmed the exact project identity, healthy state and one pending
canonical migration, then applied `0016_create_project_entitlements.sql` once. A second migrator run
created no duplicate. All three seeds were applied twice safely.

```text
project:       green-hive-staging
project ref:   rabkyesatfuezmrrzllx
region:        sa-east-1
final state:   BASELINE_READY
ledger:        16 applied, 0 pending
test artifacts: users=0, profiles=0, projects=0, settings=0, apps=0
```

The real Supabase/PostgreSQL staging matrices passed with no failure:

- RLS/database/Audit: 13/13;
- Project/Workspace Service: 10/10;
- sandbox Billing provider: 7/7;
- verified webhook concurrency and replay: 1/1;
- Entitlements: 6/6.

The Entitlements matrix proved that a pending purchase grants nothing, a paid purchase grants both
reviewed manifest capabilities exactly once, independent purchases retain independent access,
refund of every source removes access, authenticated clients cannot self-grant, decisions do not
cross user/workspace/app, and platform administration remains inspection-only.

## Published Render and HTTPS acceptance

Render automatically deployed merge commit `99a1015` on the existing Free Blueprint service. The
deploy succeeded in 50.3 seconds without a manual deploy, plan change or infrastructure change.

The public smoke passed:

```text
liveness:            PASS
readiness:           PASS
HTTPS headers:       PASS
security headers:    PASS
Reference App shell: PASS
```

The disposable authenticated HTTPS acceptance passed signup and protected cookies, refresh and
profile, projects/workspaces/Audit, the entitlement decision after verified payment, cross-user and
cross-workspace denial, forged-scope and CSRF denial, logical deletion, verified-webhook single
effect, PKCE password recovery through the dedicated Mailtrap sandbox, logout and final database/Auth
cleanup.

The hosted security smoke also passed: repeated authentication requests were limited, account scope
held, rate-limit headers were present, health probes remained exempt and security headers remained
active.

## Recovery and deferred scope

Migration `0016` remains immutable and has no destructive automatic `DOWN`. Recover by correcting
Billing truth and applying a reviewed forward migration/reconciliation; do not manually mutate grant
snapshots.

Real payment providers, checkout UI, manual grants, subscriptions, usage accounting, Cost Guard,
Jobs, AI, Redis, remote Files and consumer-domain execution remain outside this release. The next
checkpoint is GH-0401 Usage/Cost Foundation.
