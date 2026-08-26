# GH-0404 release validation — 2026-08-26

## Scope and release identity

This evidence closes GH-0404 Worker Foundation for coordinated platform version `0.17.0`. The
`REFERENCE_APP` product manifest remains `0.1.0`. Promotion covers GitHub CI, the dedicated
Supabase staging project and the existing Free-plan Render HTTPS service.

```text
feature branch:      feat/gh0404-worker-lifecycle-v0170
feature PR:          #24
feature head:        3ee92456048a5b19f45ef617f9922a3bfcf242bb
feature merge:       fc65e290f241c46b62a08d214faeeafa2c1d4a7a
successful deploy:   dep-da7ls0h5efls738rmnpg
public origin:       https://green-hive-staging.onrender.com
```

Both GitHub Actions executions of `Green Hive CI / Verify source and embedded isolation` passed:

- branch push run `33016481578`, job `98335908404`, successful in 56 seconds;
- pull request run `33016486097`, job `98335925786`, successful in 59 seconds;
- PR #24 was conflict-free and merged into `main`.

## Clean local and native Supabase gates

The source candidate passed clean installation, complete verification, dependency audit and the
guarded native local Supabase matrix:

```text
npm ci                       PASS; 170 packages, 0 vulnerabilities
npm run verify               PASS
unit tests                   110/110
embedded database            19/19
db:validate                  20 immutable migrations, 23 RLS-protected tables
npm audit --audit-level=high 0 vulnerabilities
npm run db:test:supabase     PASS; clean seeded baseline retained
release manifest             322 source files verified at the feature gate
```

Local Supabase applied and reapplied all twenty migrations without duplicate ledger entries,
reapplied all four structural seeds twice, passed every native database/RLS/service matrix and
retained the canonical seeded baseline.

## Dedicated Supabase staging

The guarded preflight found exactly nineteen applied migrations and only canonical migration
`0020_create_worker_lifecycle.sql` pending. Apply added that migration once; reapplication created
no duplicate, all previous checksums remained unchanged and all four seeds were reapplied safely.

```text
project:        green-hive-staging
project ref:    rabkyesatfuezmrrzllx
region:         sa-east-1
final state:    ACTIVE_HEALTHY / BASELINE_READY
ledger:         20 applied, 0 pending
test artifacts: users=0, profiles=0, projects=0, settings=0, apps=0
```

The complete staging database matrix passed, including exclusive concurrent claim, exact lease
ownership, heartbeat renewal, deterministic transient retry, exhaustion, permanent failure,
completion, cancellation, expired-lease recovery, authenticated denial, least privilege and Audit
secret exclusion. The first full attempt encountered a transient failure in the unchanged GH-0303
concurrent-webhook scenario and was not used as acceptance evidence. The complete rerun passed and
the final preflight again proved zero disposable database or Auth artifacts.

## Render deployment and published acceptance

Render automatically deployed feature merge `fc65e29` as `dep-da7ls0h5efls738rmnpg` in 50.2
seconds and reported `Deploy succeeded`.

```text
liveness:            PASS
readiness:           PASS; exact twenty-migration Worker contract
HTTPS headers:       PASS
security headers:    PASS
Reference App shell: PASS
hosted security:     PASS
```

The complete authenticated HTTPS acceptance matrix passed against the deployed source: signup,
protected cookies, refresh, profile, workspaces, projects, Audit, verified-payment entitlement,
verified-webhook single effect, cross-user/cross-workspace denial, forged-scope and CSRF rejection,
logical deletion, PKCE password recovery through Mailtrap and logout. Final cleanup removed every
test-owned Auth user and database row; a subsequent staging preflight still reported twenty ledger
rows, zero pending migrations and zero disposable artifacts.

## Outcome and boundary

GH-0404 is `DONE` in platform `0.17.0`. The release provides the server-only Worker lifecycle
authority over the PostgreSQL queue. It does not create a continuously running polling process,
Redis, an external broker, a new Render background worker, AI execution or a Reference App domain
handler. Those remain future, separately authorized checkpoints.
