# GH-0302 release validation - platform 0.11.0

Date: 2026-08-23
Checkpoint: `GH-0302`
Result: `DONE`

## Preserved baseline

- implementation base: `c84276acd886cb6714adf3c5023aa8a4c8a1f4d2` (`0.10.0`);
- pre-slice source backup: `green-hive-v0.10.0-pre-gh0302-20260823-061037.zip`;
- backup SHA-256:
  `3A610EDB31A41DFF19BD8B922B6890F40875F75969B193E4CC12531328222C8D`;
- the pre-existing dirty canonical worktree was not edited;
- migrations `0001` through `0013` were not changed;
- the `REFERENCE_APP` product manifest remains `0.1.0`.

## Source and review evidence

- implementation branch: `feat/gh0302-sandbox-provider-v0110`;
- implementation commit: `52f147169003468ffa416583f37232ef68e81c71`;
- implementation pull request: `#11`;
- implementation merge: `c0bf2fd794aa421dee5ac8deba075f6c260bb127`;
- GitHub CI on `main`: run `32632390189` (`Green Hive CI #45`), passed in 46 seconds;
- the implementation commit is an ancestor of the final `main` merge.

## Database and service acceptance

- migration `0014_create_sandbox_payment_transitions.sql` was applied once to the dedicated
  Supabase staging project and then recognized as already applied;
- the immutable ledger contains all 14 migrations with no pending migration;
- canonical seeds were reapplied twice without identity drift;
- local and staging SQL/RLS/Audit matrices passed 13 of 13 scenarios;
- local and staging Project/Workspace matrices passed 10 of 10 scenarios;
- local and staging GH-0302 Billing provider matrices passed 7 of 7 scenarios;
- fixture inventories were zero after the controlled staging gate;
- provider success, failure and refund retries are idempotent, including the concurrent
  transition scenario.

## Local release gates

- locked dependency installation: passed;
- `npm run verify`: passed;
- unit tests: 87 passed, 0 failed;
- embedded database/service tests: 13 passed, 0 failed;
- formatting, lint, typecheck, clean build and source security scan: passed;
- dependency audit: zero reported vulnerabilities;
- the source-only release manifest was regenerated and verified after this evidence was added.

## Render deployment

Render auto-deployed the `main` merge without manual intervention:

- service: `green-hive-staging`;
- origin: `https://green-hive-staging.onrender.com`;
- commit: `c0bf2fd794aa421dee5ac8deba075f6c260bb127`;
- deploy: `dep-da5c81e7bikc73bie1ng`;
- result: succeeded in 47.9 seconds;
- deployed at: 2026-08-23 06:57:25 GMT-3;
- `/api/ready`: HTTP 200 with `status=ready`;
- public smoke: liveness, readiness, HTTPS headers, security headers and Reference App shell
  passed.

## Release boundary

GH-0302 is complete in platform `0.11.0`. The release includes a deterministic network-free
sandbox provider, trusted payment success/failure/refund transitions and their Audit events. It
does not include a real payment provider, checkout/API surface, external webhooks, reconciliation,
Entitlements, Billing UI or card data. GH-0303 and GH-0304 remain not started.
