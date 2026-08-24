# GH-0303 implementation validation - platform 0.12.0

Date: 2026-08-23
Checkpoint: `GH-0303`
Branch: `feat/gh0303-verified-webhooks-v0120`

## Preservation

Implementation was isolated from the dirty canonical worktree at tag `v0.11.0`, commit
`507bb407e73fae3488a82d409980e916fd6a25f1`. The source-only pre-slice archive is:

```text
Engine/backups/green-hive-v0.11.0-pre-gh0303-20260823-214348.zip
SHA-256 C265F61F0DF0A77E13516F7B43555A2EB0C6A37B4935D13D8AA215ACC56807B6
```

The existing canonical worktree changes to `package.json` and
`scripts/hosted-acceptance.mjs` were not edited, reset or copied into this branch.

## Structural evidence

- migrations `0001` through `0014` remain unchanged;
- migration `0015` metadata and SHA-256 match `migrations.json`;
- `db:validate` reports 15 immutable migrations and 14 RLS-protected tables;
- provider-event raw body/signature columns are prohibited by validation and absent from the
  database;
- `REFERENCE_APP` seed and manifest remain `0.1.0` and unchanged in commercial meaning;
- GH-0304 and later packages remain contracts/placeholders without new behavior.

## Automated local evidence

- clean TypeScript typecheck: pass;
- unit suite: 92 passed, 0 failed;
- embedded PostgreSQL suites: 14 passed, 0 failed;
- exact-body signature, tamper, replay, unknown-field and stable-error scenarios: pass;
- paid, failed and refunded exact duplicate single-effect scenarios: pass;
- authenticated provider-event table/function access denial: pass;
- one payment Audit event per real state transition: pass;
- local native Supabase gate: pass;
- all 15 migrations apply once and reapply without duplication;
- concurrent duplicate deliveries produce one new result, one duplicate result and one shared
  provider-event record;
- conflicting reuse of the event identity is rejected;
- final local smoke reports ledger 15, one structural app, one sandbox product/price and no
  disposable fixture rows.

## External gates

The dedicated Supabase staging and published Render endpoint are release gates, not assumptions.
Their exact commit/deploy results are recorded in the separate GH-0303 release validation after the
branch passes CI and deployment.

## Scope conclusion

The implementation satisfies API_007, SEC_007 and SEC_008 for the deterministic fake-provider
adapter and provides a provider-neutral reconciliation contract. It does not claim real-provider
integration or Entitlement delivery.
