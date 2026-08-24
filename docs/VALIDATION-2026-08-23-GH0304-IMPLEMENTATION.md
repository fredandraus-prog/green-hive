# GH-0304 implementation validation - 2026-08-23

## Scope

Implementation validation for the Entitlements schema, transactional Billing handoff,
server-authoritative capability decision, Reference App server/HTTP integration and local Supabase
parity. This document does not claim a real payment provider, checkout, Cost Guard, Jobs, AI, Redis
or consumer-domain capability execution.

## Preserved baseline

- branch: `feat/gh0304-entitlements-v0130`;
- base: tag `v0.12.0`, commit `c3b896fc46157ec5b0d50ca5039fcc62930aa198`;
- source-only pre-slice backup:
  `green-hive-v0.12.0-pre-gh0304-20260823-231143.zip`;
- backup SHA-256:
  `83209A7B503646D54247EA370CC46DDA64B0826E1C2A8091FD9D21771D2D7279`;
- the pre-existing dirty canonical worktree was not edited; implementation used a clean linked
  worktree.

## Local evidence

```text
npm ci                                      PASS (149 packages, 0 vulnerabilities)
npm run format:check                        PASS
npm run lint                                PASS
npm run typecheck                           PASS
npm run test:unit                           PASS (97/97)
npm run db:validate                         PASS (16 migrations, 16 RLS tables)
npm run db:test                             PASS (15/15)
npm run db:test:supabase                    PASS
npm audit                                   PASS (0 vulnerabilities)
```

The native Supabase gate proved:

- all 16 migrations apply once and reapplication creates no ledger entry;
- all three structural seeds reapply without duplication;
- pending purchases grant nothing and authenticated users cannot self-grant;
- paid purchases grant both manifest capabilities exactly once;
- two independent paid purchases preserve access when only one is refunded;
- access ends after both source purchases are refunded;
- decisions do not cross user, app or workspace;
- platform administration can inspect but cannot reuse owner commands;
- a clean migrated/seeded baseline remains after fixture cleanup.

## Pending release evidence

Dedicated staging apply/test, CI, Render deployment, published HTTPS entitlement acceptance,
release manifest, extracted-ZIP verification and tag are recorded separately when the release is
promoted.

