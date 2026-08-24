# GH-0303 release validation - platform 0.12.0

Date: 2026-08-23
Checkpoint: `GH-0303`
Result: `DONE`

## Preserved baseline

- implementation base: `507bb407e73fae3488a82d409980e916fd6a25f1` (`v0.11.0`);
- pre-slice source backup: `green-hive-v0.11.0-pre-gh0303-20260823-214348.zip`;
- backup SHA-256:
  `C265F61F0DF0A77E13516F7B43555A2EB0C6A37B4935D13D8AA215ACC56807B6`;
- the pre-existing dirty canonical worktree was not edited;
- migrations `0001` through `0014` were not changed;
- the `REFERENCE_APP` product manifest remains `0.1.0`.

## Source and review evidence

- implementation branch: `feat/gh0303-verified-webhooks-v0120`;
- implementation commit: `ac0c26e32c8fcbc5a69fc1426847306ca0a90aba`;
- implementation pull request: `#13`;
- implementation merge: `610bdcbf2e13b4f47a5b09a4fb7ee6722783ae02`;
- the two GitHub checks on pull request `#13` passed;
- hosted-acceptance Audit expectation correction:
  `86682c2` on pull request `#14`;
- the correction changes only the release gate expectation. Production code and immutable migration
  `0015` are unchanged.

## Database and service acceptance

- migration `0015_create_verified_payment_webhooks.sql` was applied once to the dedicated
  Supabase staging project and then recognized as already applied;
- the immutable ledger contains all 15 migrations with no pending migration or checksum drift;
- canonical seeds were reapplied without identity drift;
- local and staging SQL/RLS/Audit matrices passed 13 of 13 scenarios;
- local and staging Project/Workspace matrices passed 10 of 10 scenarios;
- local and staging GH-0302 Billing provider matrices passed 7 of 7 scenarios;
- local and staging GH-0303 webhook matrices passed, including concurrent duplicate delivery;
- the authenticated role cannot execute the server-only webhook application function or read the
  provider-event ledger;
- exact duplicate provider events produce one payment effect and one Audit effect;
- conflicting event reuse, invalid signatures, altered payloads and replayed timestamps are denied;
- no raw webhook payload or signature is persisted;
- fixture inventories were zero after every controlled gate.

## Local release gates

- locked dependency installation: passed;
- `npm run verify`: passed;
- unit tests: 92 passed, 0 failed;
- embedded database/service tests: 14 passed, 0 failed;
- database validator: 15 immutable migrations and 14 RLS-protected tables passed;
- formatting, lint, typecheck, clean build and source security scan: passed;
- dependency audit: zero reported vulnerabilities;
- the source-only release manifest was regenerated and verified after this evidence was added.

## Render deployment

Render auto-deployed the `main` merge:

- service: `green-hive-staging`;
- origin: `https://green-hive-staging.onrender.com`;
- commit: `610bdcbf2e13b4f47a5b09a4fb7ee6722783ae02`;
- deploy: `dep-da5q2sbbc2fs73b2vc2g`;
- result: live and healthy;
- `/api/ready`: passed;
- public smoke: liveness, readiness, HTTPS headers, security headers and Reference App shell
  passed;
- hosted security smoke: rate limiting, scoped counters, response headers and health-probe
  exemption passed.

The environment-secret save initially rebuilt `0.11.0` after migration `0015` had been applied.
That old binary rejected the 15-migration baseline as designed. Deploying merge `610bdcb` restored
readiness with the matching `0.12.0` contract. This was a temporary version-ordering condition, not
a secret, TLS or build failure.

## Authenticated public HTTPS acceptance

The final hosted acceptance passed against the published origin:

- readiness and HTTPS headers: passed;
- signup, protected cookies, refresh and profile: passed;
- projects, workspaces and Audit: passed;
- cross-user and cross-workspace isolation: passed;
- forged scope and CSRF rejection: passed;
- logical deletion: passed;
- verified duplicate webhook with a single effect: passed;
- password recovery through Mailtrap: passed;
- logout: passed;
- controlled fixture cleanup: passed.

The first run exposed an outdated test expectation that still allowed only `PROJECT_CREATED` after
the new Billing flow. The gate was corrected to require `PURCHASE_CREATED` and
`PAYMENT_CONFIRMED`; the complete acceptance then passed. No production behavior was relaxed.

## Secret handling

- `GREEN_HIVE_FAKE_WEBHOOK_SECRET` is masked in Render and absent from Git;
- the matching machine-local value is protected with Windows DPAPI outside the repository;
- the plaintext value was never printed, committed, added to the manifest or packaged;
- the one-time Mailtrap recovery link was delivered only to the loopback acceptance bridge after
  explicit authorization and was not stored in release evidence.

## Release boundary

GH-0303 is complete in platform `0.12.0`. The release includes exact raw-body HMAC verification,
bounded replay protection, provider-event idempotency, payment reconciliation and single-effect
Audit application for the deterministic fake provider. It does not include a real payment provider,
checkout, card data, Billing UI or any capability grant. GH-0304 Entitlements remains not started.
