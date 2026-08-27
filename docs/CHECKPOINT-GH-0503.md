# GH-0503 — AI Gateway, model registry and schema validation

## Delivered

- strict server-only `AIGatewayService` execution boundary;
- validated model, provider, task, schema, retry, cache, sensitivity and pricing registry;
- server-owned provider/model routing with application-owned task and schema identities;
- mandatory Trust Policy evaluation and exact registered sanitizers;
- entitlement-aware Cost Guard reserve/consume/release and logical `AI_TOKENS` evidence;
- exact-decimal estimated/actual model cost with bounded normalized token usage;
- application-owned runtime structured-output validation;
- immutable migration `0021` and metadata-only `hive.ai_operations` lifecycle;
- minimized terminal AI Audit events and owner/admin read-only RLS;
- deterministic Reference App structured task with no network or secret;
- unit, embedded PostgreSQL and guarded native Supabase test paths.

## Acceptance status

GH-0503 is `DONE`. Its focused unit suite, complete embedded PostgreSQL matrix and native
local/dedicated-staging Supabase gates pass. Migration `0021` is applied remotely with 21 ledger
rows and no disposable artifacts. Feature push, pull-request and merged-`main` GitHub CI pass;
Render deploy `dep-da7vg695efls73908bcg` serves merge `80f2b3d` with database-backed readiness,
and the exact public HTTPS and hosted-security smokes pass.

## Boundaries

GH-0503 exposes no HTTP/React AI route and no provider secret. It adds no real AI provider, prompt
catalog, domain workflow, automatic classifier, persistent cache, Worker handler, Search provider,
Redis or external queue. `REFERENCE_APP` remains product version `0.1.0`. One controlled real
provider in staging remains GH-0504.

## Recovery

Migrations `0001` through `0020` remain immutable. Recovery for `0021` prefers a forward fix. Before
any controlled restoration, export and reconcile AI operation metadata, logical usage, monetary
cost, Audit evidence and the migration ledger. Raw prompts/outputs are absent and require no purge.
