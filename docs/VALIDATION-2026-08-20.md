# Validation evidence — 2026-08-20

## Scope

Green Hive platform `0.7.0`, including GH-0250 Organizations & Multi-Tenancy Foundation and
GH-0203 Audit Foundation. The `REFERENCE_APP` product manifest remains `0.1.0`.

The source-only pre-slice backups are:

```text
green-hive-v0.5.0-pre-gh0250-20260819-021546.zip
SHA-256 A05F25219F0F258E7C51CC33AA315486DB23FA704C1037636398C257E59BB89C

green-hive-v0.6.0-pre-gh0203-20260820-170711.zip
SHA-256 2744970BB93E24C8E6EE7802521DEE9DF2672EEC72825E9A79CF49C9452B285C
```

## Immutable database evidence

- Original migrations `0001` through `0006`: unchanged and checksum-valid.
- GH-0250 migrations `0007` through `0010`: sequential, metadata-complete and checksum-valid.
- GH-0203 migration `0011`: sequential, metadata-complete and checksum-valid; migrations `0001`
  through `0010` were not edited.
- `db:validate`: PASS with 11 migrations, 9 RLS-protected tables and seed/fixture separation.
- Embedded PostgreSQL/PGlite: PASS, 9 tests.
- Local Supabase fresh apply, second apply and double seed: PASS; ledger 11, seed 1.
- Local native RLS/drift matrix: PASS, 10 tests.

## Service and HTTP evidence

- Unit/App Manifest/HTTP suite: PASS, 47 tests after the final documentation consolidation.
- Project, Workspace and Audit Service on local Supabase: PASS, 10 tests.
- Auth/account on local Supabase: PASS, 10 tests.
- HTTP/cookie boundary on local Supabase: PASS, 9 tests.
- Workspace selection proves personal/shared project separation and denies foreign selection.
- Audit assertions prove transactional project create/archive/delete capture, idempotent retry,
  cross-user/cross-app/cross-organization denial, direct-write denial and payload minimization.

## Hosted staging evidence

Dedicated project: `green-hive-staging`, project ref `rabkyesatfuezmrrzllx`, region `sa-east-1`.

- GH-0250 preflight reported six applied and four pending migrations, then added only `0007`–`0010`;
- GH-0203 preflight reported 10 applied and one pending migration;
- GH-0203 apply added only `0011`, then the second apply reported all eleven as applied;
- database/RLS matrix: PASS, 10 tests;
- Project/Workspace/Audit Service matrix: PASS, 10 tests;
- Auth/account matrix: PASS, 8 tests;
- migrations and seed were applied without resetting or deleting hosted managed schemas;
- disposable users, profiles, workspaces, projects, settings and their audit events were removed;
- final preflight: `BASELINE_READY`, 11 applied, zero pending and zero disposable artifacts.

## Privacy result

The prior administrative select policies on profiles, projects and settings remain removed.
`PLATFORM_ADMIN` can read global app, organization and safe Audit operational metadata but cannot
read tenant-private profiles, projects or project settings. There is no break-glass path.

Migration `0011` grants authenticated users only tenant-scoped `SELECT` on `audit.events`. There is
no authenticated insert/update/delete grant or policy. Captured metadata contains only bounded
kind/role/status/relationship values and identifiers; no project name, arbitrary project metadata,
credential, cookie, token, prompt, document or raw payload is recorded.

## Remaining gates

GH-0201 and GH-0202 remain `PARTIAL`. Exact HTTPS hosting, the hosted HttpOnly-cookie boundary and
password recovery through dedicated test SMTP are still pending. Billing, AI, Redis, Jobs,
webhooks, storage and portfolio forecasting were not implemented.
