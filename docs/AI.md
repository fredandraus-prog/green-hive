# AI provider contract

GH-0501 establishes the provider adapter boundary without implementing the AI Gateway. The public
package is `@green-hive/ai` and exposes provider-neutral text and structured generation contracts,
strict runtime validators, stable safe errors and the deterministic `FakeAIProvider`.

## Ownership boundary

Green Hive owns the adapter interface and normalized result shape. A consuming application owns
the semantic task, input construction, prompts, output schema and interpretation. Application code
supplies a vendor-neutral model class; it cannot choose a provider-specific model or send an API
key through the provider request.

The two primitives are:

```text
AIProvider.generateText(request)
AIProvider.generateStructured(request)
```

Every request contains only:

- an app-owned operation identity that contains no prompt content;
- an app-prefixed registered task type;
- a vendor-neutral model class;
- bounded task-specific input;
- a bounded maximum output-token request;
- an app-owned output schema identity for structured generation.

Provider results normalize provider/model identity, `STOP` or `LENGTH`, logical input/output usage
and either text or JSON-compatible structured data. Runtime output-schema validation is not claimed
until GH-0503 AI Gateway.

## Deterministic fake provider

`FakeAIProvider`:

- performs no network request and requires no secret;
- returns the same output and usage for the same request and configuration;
- does not echo task input in its default response;
- deep-copies configured structured JSON so one caller cannot mutate later results;
- can deterministically simulate unavailable, timeout and generic failure states;
- exposes only stable safe errors without vendor payloads, prompts, secrets or stack details.

Fake usage is a deterministic whitespace-token approximation for repeatable tests. It is not a
vendor tokenizer or billable measurement. Real token accounting, model pricing and Cost Guard
reconciliation belong to GH-0503/GH-0504.

## Deferred scope

GH-0501 creates no database migration, provider registry, `hive.ai_operations` table, prompt/task
registry, Trust Policy, routing, fallback, retry orchestration, output-schema engine, Job handler,
Cost Guard integration, HTTP endpoint, UI or real-provider adapter. No AI operation is exposed to
the browser.
