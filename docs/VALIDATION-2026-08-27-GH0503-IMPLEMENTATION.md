# GH-0503 implementation validation — 2026-08-27

## Preserved baseline

- source base: Green Hive `0.19.0`, tag `v0.19.0`, commit `2d89ac9`;
- rollback package: `green-hive-bootstrap-gh0502-v0.19.0.zip`;
- rollback SHA-256: `541491C10DC00DE87C03F9085A925F4E14262180DB03946EAC7DDB00001BE059`;
- isolated branch: `feat/gh0503-ai-gateway-v0200`;
- migrations `0001` through `0020` remain unchanged;
- the canonical dirty worktree and its two pre-existing local changes remain untouched.

## Implementation evidence

`@green-hive/ai` now exports the Gateway, immutable registry, strict input/context validation,
exact-decimal pricing and PostgreSQL operation repository. Reference App registers one manifest-
declared structured task, app-owned runtime schema, deterministic fake model/provider and exact
confidential sanitizer. Browser input cannot select scope, provider, model, schema, capability,
limits, cost or retry behavior.

Migration `0021` creates 24th forced-RLS table `hive.ai_operations` and server-only start/complete/
fail functions. It retains no raw prompt/input/output. Successful and failed terminal transitions
emit only minimized Audit metadata. Earlier SQL checksums remain unchanged.

## Current local evidence

```text
focused AI Gateway unit tests          PASS; 6/6
embedded AI Gateway integration        PASS; 1/1
complete unit suite                    PASS; 128/128
complete embedded database suite       PASS; 20/20
db:validate                            PASS; 21 migrations, 24 RLS tables
clean npm ci + npm run verify          PASS
native local Supabase full gate        PASS; ledger 21, AI matrix pass
dedicated staging Supabase full gate   PASS; ledger 21, AI matrix pass
staging disposable artifacts           0 users/profiles/projects/settings/apps
npm dependency audit                   PASS; 0 vulnerabilities
REFERENCE_APP product manifest         unchanged; 0.1.0
real provider/network/provider secret  absent
```

The embedded integration creates a paid sandbox entitlement, configures an AI budget, executes one
structured task and proves exactly one operation, logical usage event, monetary cost event and
terminal Audit event. It also proves output-schema failure evidence, hidden request fingerprint,
cross-user/app denial, read-only owner/admin behavior and no authenticated direct lifecycle access.

## Release handoff

The first remote matrix attempt reached a transient failure in the pre-existing concurrent webhook
test. Cleanup was confirmed at zero artifacts; an unchanged controlled rerun passed every external
matrix including GH-0503. The remaining CI, deployment and public acceptance gates are recorded in
[the release validation](VALIDATION-2026-08-27-GH0503-RELEASE.md), which promotes GH-0503 to `DONE`.
