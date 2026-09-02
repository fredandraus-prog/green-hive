# GH-0504 implementation validation — 2026-08-27

## Result

`PASS_LOCAL_AND_EXISTING_STAGING — CONTROLLED_REAL_PROVIDER_GATE_PENDING`.

The fixed OpenAI Responses adapter, server-owned Reference App profile, conservative cost estimate
and one-shot paid-call runner are implemented in the isolated GH-0504 worktree. No OpenAI API key
was available, no paid provider request was made and GH-0504 remains `PARTIAL`.

## Preserved state

- base: exact `origin/main`/`v0.20.0` commit `f162e3a59bfbebb9742d4d864a5605b24e845128`;
- branch: `feat/gh0504-real-provider-v0210`;
- dirty canonical checkout: not modified;
- rollback source ZIP: existing `green-hive-bootstrap-gh0503-v0.20.0.zip` retained;
- migrations: unchanged at the immutable `0001`–`0021` ledger;
- Render Blueprint and public application routes: unchanged;
- provider key and one-shot attempt marker: absent.

## Deterministic validation

- focused Gateway, OpenAI transport and one-shot guard suite: `22 passed, 0 failed`;
- OpenAI tests use an injected transport and explicitly prove zero global-network calls;
- TypeScript integrated build: pass;
- PowerShell staging wrapper parse: pass;
- missing-provider-key command: fail closed before build/network, as designed;
- source diff whitespace check: pass.

## Clean local gate

`npm ci` installed 149 packages and audited 170 packages with zero vulnerabilities.
`npm run verify` then passed:

- format and canonical package-boundary lint;
- source/secret/browser-leak scan;
- typecheck and coordinated package build;
- `144` unit/manifest scenarios;
- `21` immutable migrations and `24` RLS-protected tables in `db:validate`;
- `20` embedded PostgreSQL database/RLS/service scenarios;
- web production bundle;
- security bundle smoke with private secrets absent.

`npm audit --audit-level=high` separately reported zero vulnerabilities.

## Dedicated Supabase staging regression

The first ordinary staging matrix run reached GH-0303 and returned one sanitized Billing webhook
processing failure while all prior blocks passed. A protected preflight immediately proved the
staging baseline healthy, with 21 applied migrations, zero pending migrations and zero disposable
artifacts. An immediate complete rerun passed all `50` scenarios:

- external RLS/Audit: `13/13`;
- Project/Workspace Service: `10/10`;
- Billing provider: `7/7`;
- verified webhook concurrency: `1/1`;
- Entitlements: `6/6`;
- Usage/Cost: `5/5`;
- Atomic Cost Guard: `5/5`;
- Jobs: `1/1`;
- Worker: `1/1`;
- AI Gateway accounting/isolation: `1/1`.

The final protected preflight again reported `BASELINE_READY`, 21 applied migrations, zero pending
migrations and zero users, profiles, projects, settings or apps owned by test fixtures. The isolated
first failure is recorded rather than hidden; no code change or relaxed assertion was used to obtain
the passing rerun.

## Security and cost conclusions

- endpoint, provider, exact model snapshot, schema, prices, limits and retry policy remain
  server-owned;
- remote snapshot mismatch, refusal, timeout, unavailable/error responses, malformed usage/JSON and
  oversized output fail with stable sanitized codes;
- `store: false`, no tools and no provider metadata are sent;
- caller input cannot inject a provider, model, key, endpoint, schema, capability, price or currency;
- the 1,024-token request allowance raises only the reservation; provider-reported usage determines
  actual cost;
- the paid command is absent from every routine/CI/Render path;
- the DPAPI key is read only for the paid operation and process variables are cleared in `finally`;
- an atomic persistent marker is created immediately before the paid boundary and blocks silent
  retries after success, failure or interruption.

## Remaining gate

To close GH-0504, an operator must create a dedicated provider key and minimal provider-side spending
controls, store the key as the documented Windows-user-bound DPAPI blob, recheck official snapshot
pricing and authorize one execution of `npm run ai:real:test:staging`. Only a successful real call and
its clean evidence permit `DONE`; that evidence must be incorporated into the then-current platform
release, manifest, ZIP, merge/tag and deployment validation. Because independent checkpoints may
advance first, closing GH-0504 does not require creating a retrospective `v0.21.0` tag.
