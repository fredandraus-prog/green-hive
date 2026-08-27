# AI Gateway and provider contracts

GH-0501 established the provider-neutral adapter. GH-0503 composes that adapter behind the
server-only `AIGatewayService`, a validated task/model/schema registry, Trust Policy, Entitlements,
Cost Guard and Usage/Cost accounting. GH-0504 adds one fixed OpenAI Responses implementation and a
separate one-shot staging gate; it does not expose an AI endpoint to the browser.

## Authority boundary

Application code supplies only a trusted user/app/workspace context and:

- owned `projectId` and the server-created AI `budgetId`;
- a unique operation identity;
- an app-prefixed registered task type;
- bounded task input and its trusted classification;
- optional confidential mode for a separately controlled confirmation policy.

It cannot supply `owner_user_id`, `app_id`, provider, provider model, output schema, capability,
token limits, price, currency, retry policy or sanitizer. The registry rejects unknown and
inconsistent composition at startup. Routing selects an enabled model by the task's vendor-neutral
model class and server priority.

## Execution order

```text
trusted context + strict input
  -> registered task and sensitivity ceiling
  -> server model/provider route
  -> exact Trust Policy decision and required sanitizer
  -> bounded token/cost estimate
  -> metadata-only AI operation start
  -> entitlement-aware Cost Guard reservation
  -> provider call with controlled retry
  -> actual cost consumption + logical token event
  -> application-owned runtime output-schema validation
  -> terminal AI operation + minimized Audit event
```

Unknown tasks, models and schemas fail closed. `HIGHLY_CONFIDENTIAL` input is denied by the
canonical Trust matrix. `CONFIDENTIAL` input reaches the provider only after the task registers the
exact sanitizer named by Trust Policy. Provider retries are limited to three attempts and only
explicit `UNAVAILABLE`/`TIMEOUT` failures may be retried.

## Accounting and storage

Model prices are exact decimal strings. The Gateway reserves the worst-case registered output cost,
plus a conservative server-owned allowance for provider instructions/schema framing, then consumes
the normalized actual provider usage and records an `AI_TOKENS` usage event. The allowance affects
only reservation; actual cost always uses the provider-reported token counts. The Gateway never
accepts an amount or capability from caller input.

Migration `0021` creates `hive.ai_operations`. It stores tenant/project scope, task/schema identity,
provider/model metadata, Trust decision, token counts, exact costs, status, safe error and a SHA-256
request fingerprint. Raw prompts, task input, provider output, secrets and responses are prohibited.
Owners and platform administrators have limited read-only RLS views; authenticated clients cannot
write the table, read the fingerprint or execute lifecycle functions. Only the trusted backend may
start, complete or fail an operation.

## Reference App proof

The product manifest remains `0.1.0` and already declares `REFERENCE_APP_STRUCTURED_ECHO`. Its
server-owned configuration registers `REFERENCE_APP_ECHO_V1`, the vendor-neutral
`GENERAL_STRUCTURED` class, the existing `REFERENCE_APP_RUN_JOB` capability, an AI cost budget,
bounded limits and the deterministic network-free provider. No AI browser route or UI is exposed.

## GH-0504 OpenAI staging profile

The only real adapter currently registered is `OpenAIResponsesProvider`:

- endpoint fixed to `https://api.openai.com/v1/responses`;
- remote model fixed to `gpt-4o-mini-2024-07-18` and mapped to the canonical Green Hive code
  `OPENAI_GPT_4O_MINI_2024_07_18`;
- `store: false`, no tools, no metadata and strict server-owned JSON Schema;
- fixed USD rates of `0.00015` input and `0.00060` output per one thousand tokens, corresponding to
  the documented USD 0.15/0.60 per million token rates reviewed on 2026-08-27;
- 1,024 estimated input tokens reserved for instructions and schema framing;
- Reference App task maximums of 128 input and 64 output tokens;
- `INTERNAL` maximum classification and one attempt with no retry;
- 30-second default deadline, 1 MiB response limit and safe normalized failure codes.

The adapter validates that the provider returns the exact model snapshot. Provider aliases, remote
error bodies, refusals, unexpected completion states, invalid usage, oversized responses and JSON
that fails the application validator are rejected without exposing vendor details.

## Secret and paid-call boundary

No OpenAI key belongs in Git, `.env`, Render, browser code, Supabase, Audit or operation metadata.
The Windows staging wrapper reads only
`Engine/.secrets/green-hive-staging-openai-api-key.dpapi`, protected for the current Windows user,
and removes the plaintext environment value in `finally`.

`npm run ai:real:test:staging` is intentionally absent from `verify`, CI, the normal staging matrix
and Render startup. Immediately before the provider call it atomically creates
`Engine/.secrets/green-hive-gh0504-real-provider-attempt-v0.21.0.json`. That non-secret marker is not
deleted automatically after success or failure, preventing a silent second attempt. The internal AI
budget ceiling is USD `0.0002`; the controlled four-token request reserves USD `0.0001926` and the
profile permits exactly one provider attempt.

## Deferred scope

GH-0504 adds no public HTTP/browser AI feature, general prompt catalog, domain workflow, automatic
content classifier, persistent cache, worker handler, Search integration, Redis or Render secret.
Application prompts and domain workflows remain owned by consuming applications, never by the
reusable platform Gateway. GH-0504 remains `PARTIAL` until the dedicated provider credential,
provider-side spending control and controlled real staging call are completed.
