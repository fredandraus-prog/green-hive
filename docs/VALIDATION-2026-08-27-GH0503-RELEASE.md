# GH-0503 release validation — 2026-08-27

## Scope and release identity

This evidence closes GH-0503 AI Gateway for coordinated platform version `0.20.0`. The
`REFERENCE_APP` product manifest remains `0.1.0`. The Gateway uses only the deterministic fake
provider in this slice; no real provider, provider secret or public AI route exists.

```text
feature branch:      feat/gh0503-ai-gateway-v0200
feature PR:          #30
feature head:        ce53701c7bb4307394417a1d7375ee00bffd7cca
feature merge:       80f2b3d390aef0ce1e54be1bae6314b495c54449
successful deploy:   dep-da7vg695efls73908bcg
public origin:       https://green-hive-staging.onrender.com
```

## GitHub CI

Every GitHub Actions execution of `Green Hive CI / Verify source and embedded isolation` passed:

- feature push run `33054775434`, job `98458709617`;
- pull request run `33054885869`, job `98459084665`;
- merged-`main` run `33055020149`, job `98459535405`.

PR #30 was conflict-free and merged into `main`.

## Clean local and database gates

```text
npm ci                       PASS; 170 packages, 0 vulnerabilities
npm run verify               PASS
focused Gateway tests        PASS; 6/6
unit tests                   PASS; 128/128
embedded database            PASS; 20/20
db:validate                  PASS; 21 immutable migrations, 24 RLS tables
native local Supabase        PASS; complete matrix, ledger 21
dedicated staging Supabase   PASS; complete matrix, ledger 21
staging disposable artifacts PASS; 0 users/profiles/projects/settings/apps
npm audit --audit-level=high PASS; 0 vulnerabilities
release source manifest      PASS; 356 release-source entries verified
```

The first dedicated-staging full-matrix attempt reached a transient failure in the pre-existing
concurrent Billing webhook test. Cleanup completed with zero artifacts. An unchanged controlled
rerun passed every matrix, including the GH-0503 Gateway lifecycle and isolation gate. Final
preflight reported `BASELINE_READY`, 21 applied migrations, zero pending migrations and zero
disposable artifacts.

## Render and public acceptance

Render automatically deployed feature merge `80f2b3d` as `dep-da7vg695efls73908bcg` in 60 seconds
and reported it deployed on 2026-08-27 at 05:40:57 America/Sao_Paulo.

```text
liveness:                  PASS
readiness:                 PASS; twenty-one-migration contract
HTTPS headers:             PASS
security headers:          PASS
Reference App shell:       PASS
hosted Auth rate limiting: PASS
health-probe exemption:    PASS
```

GH-0503 intentionally exposes no HTTP AI workflow, so there is no hosted browser AI scenario to
exercise. The database-backed readiness check proves that the published application and immutable
`0021` staging baseline agree. The complete native staging matrix exercises the server-only Gateway
using native Supabase Auth helpers and the `authenticated` role.

## Outcome and boundary

GH-0503 is `DONE` in platform `0.20.0`. It establishes server-owned task/model/schema routing,
mandatory Trust and entitlement enforcement, atomic Cost Guard reconciliation, exact usage/cost
evidence, runtime output-schema validation and metadata-only operation/Audit records. It does not
add a real AI provider, provider secret, public AI route, prompt catalog, Search integration,
persistent cache, Redis or external queue. One controlled real provider in staging remains GH-0504.
