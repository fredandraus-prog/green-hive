# GH-0401 implementation validation — 2026-08-24

## Scope

This evidence validates GH-0401 Usage/Cost Foundation for coordinated platform version `0.14.0`.
The `REFERENCE_APP` product manifest remains `0.1.0`. GH-0402 reserve/consume/release decisions and
all later providers/workers remain outside this evidence.

## Preservation and branch

```text
base tag:       v0.13.0
base commit:    90bc62147c18be1f9689ce71705a74a6ebb4b300
branch:         feat/gh0401-usage-cost-foundation-v0140
pre-slice ZIP:  green-hive-v0.13.0-pre-gh0401-20260824-011029.zip
ZIP SHA-256:    30D5C675AE544722F20CB34B6A556C9142E87197F815EBC58C9B7431DB3A34B2
```

The canonical dirty worktree was not used. Work occurred in a clean dedicated Git worktree.

## Local source and embedded gates

```text
npm install --package-lock-only  PASS; audit 0 vulnerabilities
npm run typecheck                PASS
npm run test:unit                PASS; 101/101
npm run db:validate              PASS; 17 migrations, 19 RLS tables
npm run db:test                  PASS; 16/16
npm run verify                   PASS
```

The GH-0401 embedded matrix proved:

- exact-decimal budget, logical usage and monetary cost persistence;
- identical retries return one row;
- conflicting idempotency reuse fails closed;
- debit/credit aggregation preserves exact values;
- cross-user and cross-app access returns no foreign rows;
- forged project/budget scope is rejected;
- owner reads budgets and usage but not raw monetary costs;
- platform admin reads operational evidence but cannot write;
- authenticated clients cannot execute internal functions, mutate rows or physically delete;
- two budget configurations create two bounded Audit events, while event-ledger details are not
  duplicated into Audit.

## Native local Supabase

The guarded local gate used native PostgreSQL 17.6, `auth.users`, `auth.uid()`, `auth.jwt()` and the
real `authenticated`/`service_role` grants.

```text
migrations applied:       17
migration reapply:        0 duplicates
seeds applied twice:      PASS
external RLS regression:  13/13
Project/Workspace:        10/10
Billing:                  7/7
Webhook:                  1/1
Entitlements:             6/6
Usage/Cost:               5/5
final smoke:              PASS
final local baseline:     clean, migrated and seeded
```

## Dedicated Supabase staging

The guarded staging apply identified only the confirmed project and applied migration `0017` once.
The second migrator run applied nothing and every prior migration checksum remained unchanged.

```text
project:        green-hive-staging
project ref:    rabkyesatfuezmrrzllx
region:         sa-east-1
state:          BASELINE_READY
ledger:         17 applied, 0 pending
Usage/Cost:     5/5 passed
test artifacts: users=0, profiles=0, projects=0, settings=0, apps=0
```

The staging test repeated all preceding database/service matrices. Cleanup removed only fixed test
fixtures and retained the structural `REFERENCE_APP`, sandbox catalog and entitlement mappings.

## Security and deferred behavior

- no secrets, provider payloads, prompts or document contents are stored;
- no browser write endpoint was added;
- no raw monetary-cost owner endpoint was added;
- no migration `0001` through `0016` was changed;
- no real provider, checkout, Jobs, AI, Redis, webhook change, remote Files or consumer-domain
  behavior was added;
- no reserve, consume, release, allow/deny or no-overspend decision was added.

GitHub CI, merge identity, Render deployment, published readiness/HTTPS checks and the final release
ZIP are recorded in the separate GH-0401 release validation evidence after promotion.
