# GH-0301 release validation - platform 0.10.0

Date: 2026-08-23
Checkpoint: `GH-0301`
Result: `DONE`

## Preserved baseline

- implementation base: `0b3955f5eb6ab75f8366e4a1bc3ccdb2a8116be2` (`0.9.0`);
- pre-slice source backup: `green-hive-v0.9.0-pre-gh0301-20260823-020330.zip`;
- backup SHA-256:
  `D8F206786F6916C986B0C956E4FFF760F9558815E95EBB0D7299958E66545D3F`;
- the pre-existing dirty canonical worktree was not edited;
- migrations `0001` through `0011` were not changed.

## Source and review evidence

- implementation branch: `feat/gh0301-billing-foundation-v0100`;
- implementation commit: `dfb72ad8a3a29947e5f42a4561e28e7eafd1e01e`;
- source-manifest commit: `12c3802089e6c78fc5b71985e6910dba007a08bb`;
- staging-fixture isolation commit: `8cfd7a93b9cd461f5bae0fd1924ad1d88cc280af`;
- pull request: `#9`;
- implementation merge: `fb3dede0df7a2fd6757726406278106a9887e1c1`;
- GitHub CI after the final correction: two successful checks and no merge conflicts.

## Database delivery

Two new immutable migrations were delivered:

- `0012_create_billing_catalog.sql` - app-scoped products and exact-decimal price versions;
- `0013_create_purchases_and_payments.sql` - tenant purchase/payment snapshots, trusted pending
  purchase creation, RLS, restricted grants and `PURCHASE_CREATED` Audit capture.

The canonical `REFERENCE_APP` Billing seed was reapplied twice with fixed product and price
identities. The app product manifest remains `0.1.0`; only the coordinated platform version moved
to `0.10.0`.

## Local gates

- clean locked dependency installation: passed;
- source verification: 83 unit tests passed;
- embedded database verification: 13 tests passed;
- database validator: 13 immutable migrations and 13 RLS-protected tables passed;
- native local Supabase SQL/RLS matrix: 13 of 13 passed;
- native local Supabase Project/Workspace matrix: 10 of 10 passed;
- native local Supabase Billing Service matrix: 6 of 6 passed;
- clean build, lint, formatting, typecheck and source security scan: passed;
- dependency audit at high severity: zero vulnerabilities;
- release manifest before this evidence file: 248 source files verified.

## Dedicated Supabase staging gates

Target identity:

- project: `green-hive-staging`;
- project reference: `rabkyesatfuezmrrzllx`;
- region: `sa-east-1`;
- health: `ACTIVE_HEALTHY`.

Final state and results:

- immutable ledger: 13 applied, zero pending;
- canonical seeds: applied twice without identity drift;
- SQL/RLS/Audit matrix: 13 of 13 passed;
- Project/Workspace Service matrix: 10 of 10 passed;
- Billing Service matrix: 6 of 6 passed;
- final fixture inventory: zero users, profiles, projects, settings and test apps.

The first hosted matrix run exposed historical test assumptions that staging contained no real
workspaces or projects. Commit `8cfd7a9` made those assertions fixture-scoped and changed seed
conflict tests to reversible transactional identity changes. No production row or managed schema
was deleted to satisfy the tests.

## Render deployment

After pull request `#9` was merged, the public service returned:

- `/api/ready`: HTTP 200 and `status=ready` against the 13-migration baseline;
- public smoke: liveness passed;
- readiness passed;
- HTTPS and security headers passed;
- Reference App shell passed.

Validated origin: `https://green-hive-staging.onrender.com`.

## Release boundary

GH-0301 records commercial intent and provider-neutral payment attempts. It does not implement a
payment provider, confirmation/failure/refund transitions, external webhooks, Entitlements,
Billing HTTP endpoints or Billing UI. Those capabilities remain explicitly outside `0.10.0` and
begin with the GH-0302 fake/sandbox provider slice.
