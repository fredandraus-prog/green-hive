# AI Gateway and provider contracts

GH-0501 established the provider-neutral adapter. GH-0503 composes that adapter behind the
server-only `AIGatewayService`, a validated task/model/schema registry, Trust Policy, Entitlements,
Cost Guard and Usage/Cost accounting.

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
then consumes the normalized actual provider usage and records an `AI_TOKENS` usage event. It never
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

## Deferred scope

GH-0503 adds no real provider, provider secret, prompt catalog, HTTP endpoint, frontend AI feature,
automatic content classifier, persistent cache, worker handler, Search integration or Redis.
One controlled real staging provider remains GH-0504. Application prompts and domain workflows
remain owned by consuming applications, never by the reusable platform Gateway.
