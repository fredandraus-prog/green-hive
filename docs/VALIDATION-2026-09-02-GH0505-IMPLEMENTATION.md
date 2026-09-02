# GH-0505 implementation validation — 2026-09-02

Status: `PASS_LOCAL — CI, DEDICATED STAGING, RENDER AND RELEASE EVIDENCE PENDING`.

This document records the observed local implementation evidence for GH-0505. The deterministic,
embedded and native local Supabase gates are complete. It does not claim that CI, dedicated staging,
Render deployment or the final release package have completed.

## Baseline and isolation

- source base: `origin/main` commit `06518afe517d53babc4856ccb5e63e9265fa1789`;
- isolated branch: `feat/gh0505-fake-search-v0220`;
- current source version at branch creation: `0.21.0`;
- intended coordinated release target: `0.22.0`;
- last completed release/tag: `v0.20.0`;
- migrations `0001` through `0021` are published and must remain unchanged;
- new immutable migration: `0022`, checkpoint `GH-0505`, SHA-256
  `bd86b2ec8aa1b68b9f1ea504ba0aa5941712419e94e8d3806cf8eb2a7ab1a3ab`;
- the `REFERENCE_APP` product manifest remains `0.1.0`;
- GH-0504 remains `PARTIAL — REAL STAGING GATE PENDING`.

The retained rollback package observed at the start of this slice is
`Engine/backups/green-hive-bootstrap-gh0503-v0.20.0.zip`, SHA-256
`9512836C1E1D0EBA46A8608DA0CE0394EDD8676470A7D53EE7992D2FB459BB4B`. It must not be removed until a
new final source-only package has been generated, extracted and fully validated.

## Implemented evidence

The local candidate introduces:

- `SearchProvider`, strict request/result contracts and stable errors;
- deterministic `FakeSearchProvider` with `UNTRUSTED_EXTERNAL_DATA` results;
- `SearchGatewayService`, `SearchGatewayRegistry` and runtime registry validation;
- mandatory `SEARCH_QUERY` Trust enforcement and registered `ABSTRACT_QUERY` sanitization;
- server-owned capability, exact-decimal Search cost, maximum-result routing and bounded retry;
- an estimate of request cost times maximum attempts plus result cost times maximum results;
- actual successful cost based on physical provider attempts plus returned results, with every retry
  counted as another provider call;
- Cost Guard reservation/release plus atomic reservation consumption, logical Search usage and
  terminal operation completion through `hive.complete_search_operation_accounted(...)`;
- atomic post-reservation release and failed operation/Audit transition through
  `hive.fail_search_operation_accounted(text, uuid, text)`, while the simple failure function
  accepts only operations with no reservation;
- exact reservation-estimate equality for both accounted terminal paths and literal full-app-code
  namespace validation that remains correct when the app code contains underscores;
- `PostgresSearchOperationRepository`;
- migration `0022` with metadata-only `hive.search_operations`, lifecycle writers, Audit capture,
  limited owner/admin read access and no authenticated write/delete path;
- focused unit, embedded PostgreSQL and native Supabase isolation tests.

Operation, Usage/Cost and Audit persistence must omit raw and sanitized queries, titles, URLs,
snippets, full result objects, provider response bodies and secrets. The SHA-256 query fingerprint
is operational identity evidence, not recoverable query storage.

## Validation ledger

| Gate | Required evidence | Current result |
|---|---|---|
| package/type build | coordinated Search package exports and TypeScript references | `PASS` |
| focused Search unit suite | provider, gateway, registry, validation, Trust, retry-aware cost and failure cases | `PASS — 16/16` |
| zero-network proof | fake execution attempts no fetch/socket/provider request | `PASS — static scan plus deterministic injected-fetch tests` |
| database validation | migration `0022` metadata, sequence, checksum and policy contract | `PASS — 22 immutable migrations; 25 RLS tables` |
| embedded PostgreSQL | Search lifecycle, accounting, Audit, rollback and RLS scenarios | `PASS — Search 1/1; complete embedded gate 21/21` |
| native local Supabase | apply/reapply, seed replay, isolation, atomic rollback and concurrent identity conflict | `PASS — Search 1/1; complete local gate passed and restored a clean baseline` |
| dedicated staging Supabase | guarded Search matrix and zero disposable artifacts | `NOT_RUN` |
| clean monorepo gate | `npm ci`, `npm run verify`, dependency audit | `PASS — 149 packages; 160 unit; 21 embedded; 0 vulnerabilities` |
| release source manifest | regenerated inventory and SHA-256 verification | `NOT_RUN` |
| GitHub branch/PR/main CI | exact run and job identities | `NOT_CREATED` |
| Render Free/public HTTPS | exact deployed commit, readiness and security smoke | `NOT_DEPLOYED` |
| release evidence/tag/ZIP | platform `0.22.0` final package | `NOT_STARTED` |

PR, CI, staging, deploy, release-manifest, tag and ZIP identities remain absent until observed.
Passing deterministic local tests alone does not justify changing the checkpoint to `DONE` before
the remaining applicable free gates complete.

## Cost-free and provider boundary

All GH-0505 provider tests must use `FakeSearchProvider`. On successful accounted completion, each
invocation increments the physical request count, including every controlled retry, while still
making no network call. The internal exact-decimal values used by the Search registry exercise Cost
Guard and Usage/Cost accounting but do not represent a provider invoice. This slice must create no
Search account, key, subscription or real provider request.

The separate command `npm run ai:real:test:staging` is not part of this validation plan and must not
be executed for GH-0505. No OpenAI key or paid request is required. Deferring that command preserves
GH-0504 honestly as `PARTIAL` without blocking this independent checkpoint.

## Release handoff

There is no release handoff yet. GH-0505 remains `PARTIAL/PASS_LOCAL`. A later
release-evidence document may promote it to `DONE` only after the implementation, free validation
gates, CI, existing Render Free smoke, final manifest and extracted ZIP have all been observed and
recorded. GH-0504 must remain separately visible as pending its controlled paid gate.
