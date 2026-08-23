# Validation 2026-08-23 - GH-0204 and platform 0.9.0

## Result

GH-0204 is `DONE`. The bounded Security Baseline passes locally and on the exact published Render
service without adding Billing, AI, Redis, Jobs, external webhooks, remote storage or a distributed
quota.

## Provenance and deployment

- pre-slice base: `c294bfd574034361d2481f8545663214cd15b6c0`;
- implementation commit: `1464d9b517291be3d1a56e07db271950df984725`;
- implementation PR: GitHub PR #7;
- deployed merge commit: `67b55cfb4268312a7ba146f40811af7b499866e5`;
- Render deploy: `dep-da56dmoae00c73b2pcog`;
- exact origin: `https://green-hive-staging.onrender.com`;
- deployment result: succeeded in 49.4 seconds.

The source-only pre-slice backup remains preserved at:

```text
Engine/backups/green-hive-v0.8.0-pre-gh0204-20260822-234843.zip
SHA-256 E8CD7E815D0F3C473F72DBF6157E47DA2FD4885AB30F2DAD7851D95DD55C367D
```

## Local gates

- clean dependency installation: pass;
- complete `npm run verify`: pass;
- unit suite: 77 tests, zero failures;
- embedded database/RLS suite: 9 tests, zero failures;
- database catalog: 11 immutable migrations and 9 RLS-protected tables;
- production bundle secret smoke: `SECURITY_BUNDLE_SMOKE_PASS` across four built files;
- dependency audit: zero vulnerabilities;
- implementation-phase release manifest: 234 source files verified;
- final `0.9.0` release manifest: 235 source files verified after this evidence file was added.

## Hosted gates

The public smoke passed liveness, database readiness, HTTPS headers, hardened security headers and
the Reference App shell.

`HOSTED_SECURITY_SMOKE_PASS` proved:

- ten guarded invalid sign-ins reached the Auth boundary;
- the eleventh request returned the stable `429 RATE_LIMITED` contract;
- a separate account bucket remained independent;
- limit and retry metadata were present;
- health and readiness remained unthrottled.

`PUBLIC_HTTPS_ACCEPTANCE_PASS` then repeated signup, protected cookies, refresh, profile,
projects/workspaces/Audit, cross-user and cross-workspace denial, forged-scope and CSRF denial,
logical deletion, PKCE recovery through Mailtrap and logout.

## Cleanup evidence

- the acceptance runner reported `cleanup: PASS` for test-owned Auth users, profiles, projects,
  memberships, organizations and Audit events;
- the recovery link crossed only the one-shot loopback bridge and was consumed without being
  printed or persisted;
- Mailtrap message `5659851675`, addressed only to the disposable acceptance recipient, was
  deleted after the run;
- Mailtrap confirmed that the `green-hive-staging` sandbox was empty.

## Release boundary

Coordinated platform packages advance to `0.9.0`. The `REFERENCE_APP` product manifest remains
`0.1.0`, because GH-0204 changes the reusable platform boundary rather than the Reference App
product contract. A distributed limiter remains mandatory before multi-instance scale-out, while
the current single-instance bounded baseline remains complete.
