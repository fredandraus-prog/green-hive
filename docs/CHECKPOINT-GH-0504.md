# GH-0504 — controlled real AI provider in staging

Status: `PARTIAL — IMPLEMENTATION PASS; REAL STAGING CALL PENDING`.

## Objective

Prove that one real provider can execute a small registered task through the existing Green Hive AI
Gateway while preserving Trust Policy, Entitlements, Cost Guard, Usage/Cost, operation metadata,
Audit minimization and tenant isolation. The canonical specification intentionally leaves the first
vendor/model open; this slice selects a reversible OpenAI adapter behind `AIProvider`.

## Implemented boundary

- provider code: `OPENAI`;
- canonical model code: `OPENAI_GPT_4O_MINI_2024_07_18`;
- remote endpoint: fixed `https://api.openai.com/v1/responses`;
- remote model: exact `gpt-4o-mini-2024-07-18` snapshot;
- provider storage: disabled with `store: false`;
- tools and provider metadata: not sent;
- output: strict application-owned JSON Schema with only
  `{ "result": "REFERENCE_APP_AI_SUCCESS" }`;
- classification ceiling: `INTERNAL`;
- task limits: 128 input tokens and 64 output tokens;
- timeout: 30 seconds by default;
- response bounds: 1 MiB transport body and 262,144 output characters;
- retry: one attempt, no retryable provider errors;
- price registry: USD `0.00015` input and `0.00060` output per thousand tokens;
- request allowance: 1,024 input tokens reserved for instructions/schema framing only.

The adapter validates the exact model snapshot returned by the provider and fails closed for remote
errors, refusal, unexpected/incomplete states, invalid usage, malformed JSON and oversized output.
Vendor response bodies, keys, prompts and outputs never enter public errors or persistent metadata.

## One-shot paid gate

`npm run ai:real:test:staging` is a manual command outside routine tests, `verify`, CI, Render and the
public Reference App. It reads the provider key only from the Windows-user-bound DPAPI blob:

```text
Engine/.secrets/green-hive-staging-openai-api-key.dpapi
```

The runner requires the exact dedicated Supabase staging identity and creates one disposable owner,
project, entitlement and USD budget. Its four-token input reserves USD `0.0001926` against a USD
`0.0002` ceiling, so two simultaneous reservations cannot fit. The task has `maxAttempts: 1`.

Immediately before the provider boundary, the runner atomically creates:

```text
Engine/.secrets/green-hive-gh0504-real-provider-attempt-v0.21.0.json
```

That marker contains only an operation identity, purpose and timestamp. It is retained after success,
provider failure or process interruption. The runner therefore cannot silently make a second paid
attempt; any later attempt requires explicit investigation and authorization.

## Acceptance evidence required for DONE

GH-0504 can move to `DONE` only when all of the following are true:

1. a dedicated provider project/key and minimal provider-side spending/rate controls are confirmed;
2. current pricing for the exact snapshot is rechecked against the server registry;
3. the DPAPI blob is created without exposing its plaintext value;
4. the one-shot command succeeds once;
5. provider/model/schema, positive token use, estimated/actual USD cost, consumed reservation,
   `AI_TOKENS`, cost ledger and `AI_OPERATION_COMPLETED` evidence all agree;
6. prompt, response and key material are absent from stored evidence;
7. disposable database/Auth fixtures are zero after cleanup;
8. CI, Render readiness and public HTTPS/security smokes remain green;
9. the successful gate is incorporated into the then-current platform release evidence, manifest,
   ZIP and tag. No retrospective `v0.21.0` tag is required after later independent slices advance
   the coordinated platform version.

## Current result and deferred scope

All implementation, deterministic provider-transport, clean local and ordinary dedicated-staging
gates pass. No provider key is installed and no paid request has been made, so the acceptance line
“controlled real staging task passes” is not yet satisfied.

This checkpoint adds no migration, Render secret, public AI endpoint/UI, general prompt catalog,
consumer-domain workflow, Search, Redis, persistent cache, external queue or Worker handler. The
Reference App product manifest remains `0.1.0`.

## Recovery

There is no database rollback because GH-0504 adds no migration. The OpenAI composition is isolated
behind `AIProvider`; routine and CI execution continue to use the deterministic fake provider.
Removing or disabling the OpenAI staging factory and command restores the pre-slice execution path.
The one-shot marker is operational evidence, not a cache: it must never be deleted merely to rerun a
failed paid call without first reviewing whether the provider may already have processed it.
