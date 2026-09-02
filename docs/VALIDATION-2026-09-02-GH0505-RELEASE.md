# GH-0505 release validation — 2026-09-02

## Scope and release identity

This evidence closes GH-0505 Search Gateway for coordinated platform version `0.22.0`. The
`REFERENCE_APP` product manifest remains `0.1.0`. The only Search provider is deterministic and
network-free; the slice created no Search account, subscription, key, external request or charge.

```text
feature branch:      feat/gh0505-fake-search-v0220
implementation:      b516f36
feature head:        db75e9d
feature PR:          #33
feature merge:       37c7752459579809fdd77a4ddb0eee1783402617
public origin:       https://green-hive-staging.onrender.com
```

PR: <https://github.com/fredandraus-prog/green-hive/pull/33>

## GitHub CI

Every observed `Green Hive CI / Verify source and embedded isolation` execution passed:

- feature push run `33674102364`, job `100394516607`;
- pull-request run `33674109163`, job `100394739457`;
- merged-`main` run `33674780092`, completed in 1 minute 11 seconds.

PR #33 was conflict-free and merged into `main`.

## Clean local and database gates

```text
npm ci                       PASS; 149 packages, 0 vulnerabilities
npm run verify               PASS; 160 unit, 21 embedded database scenarios
db:validate                  PASS; 22 immutable migrations, 25 RLS tables
native local Supabase        PASS; complete matrix, Search 1/1
dedicated staging Supabase   PASS; complete matrix, Search 1/1
staging migration ledger     PASS; 22 applied, 0 pending
staging disposable fixtures PASS; 0
staging Auth/account         PASS; 8/8
release manifest feature gate PASS; 380 source files verified
```

Migration `0022_create_search_gateway_operations.sql` is recorded in staging with SHA-256
`bd86b2ec8aa1b68b9f1ea504ba0aa5941712419e94e8d3806cf8eb2a7ab1a3ab`. Reapplication created no
duplicate and the final baseline retained only reviewed structural seeds.

The first complete staging attempt reached an intermittent failure in the pre-existing concurrent
Billing webhook test. Cleanup completed. A complete unchanged rerun passed that scenario, Search
and every other matrix. The final ledger, cleanup and Search-specific results provide no evidence
of a migration `0022` regression; the first result is retained here as transparent transient
evidence and is not treated as an acceptance failure.

## Render and public acceptance

GitHub marked merge `37c7752` **Deployed** and active in environment
`main - green-hive-staging` on 2026-09-02 at 16:42 America/Sao_Paulo. The Render dashboard session
expired before its provider-specific deploy ID could be recorded. This document therefore does not
infer or invent a Render deploy ID.

```text
public hosted smoke:       PASS
hosted security smoke:     HOSTED_SECURITY_SMOKE_PASS
database readiness:        PASS; twenty-two-migration contract
HTTPS/security headers:    PASS
Reference App shell:       PASS
```

GH-0505 exposes no public Search route or Search UI. The native dedicated-staging matrix exercises
the server-only Gateway with real PostgreSQL/Supabase authorization boundaries, while the hosted
smokes prove that the application deployed against the new immutable database baseline remains
healthy and hardened.

## Outcome and paid boundary

GH-0505 is `DONE` in platform `0.22.0`. It establishes provider-neutral Search contracts,
deterministic fake results marked `UNTRUSTED_EXTERNAL_DATA`, Trust and Cost Guard enforcement,
retry-aware exact accounting, atomic success/failure finalization and tenant-safe metadata-only
operation/Audit evidence.

No real Search provider, provider key, crawler, network retrieval, persistent result cache, Redis,
public Search route or consumer-domain workflow is included. GH-0504 remains `PARTIAL — REAL
STAGING GATE PENDING`; `npm run ai:real:test:staging` was not executed and no OpenAI paid request
was made.

## Release-distribution handoff

After this documentation is finalized, the release branch must regenerate and verify
`MANIFEST-SHA256.txt`, validate a freshly extracted source-only archive and create the `v0.22.0`
tag. Those distribution identities must be reported only after they are observed; this evidence
does not predeclare a ZIP checksum or tag object.
