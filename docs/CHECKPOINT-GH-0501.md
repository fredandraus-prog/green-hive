# GH-0501 — AI Provider Foundation

## Delivered

- provider-neutral `AIProvider` with text and structured generation primitives;
- app-prefixed task and schema identities plus vendor-neutral model classes;
- strict request/result/JSON runtime validation and bounded technical inputs;
- normalized provider/model, finish reason and logical usage metadata;
- deterministic, network-free `FakeAIProvider` with isolated structured output;
- stable unavailable, timeout, invalid-input, invalid-output and generic failure errors;
- tests proving deterministic output, forbidden provider authority and zero network calls.

## Acceptance status

Local implementation and focused tests pass. GH-0501 remains `PARTIAL` until the complete clean
gate, GitHub push/PR checks, the existing Render build/readiness contract and release evidence pass.
No dedicated Supabase mutation or matrix is required because this checkpoint adds no migration or
database behavior.

## Boundaries

This checkpoint is the adapter foundation, not the AI Gateway. It does not implement Trust Policy,
provider/model registry, schema execution, task routing, retry/fallback orchestration, Jobs/Cost
Guard integration, AI persistence, a real provider, secrets, browser/API access or Reference App
AI behavior. Those remain GH-0502 through GH-0504.

## Recovery

GH-0501 is source-only. Rollback means returning all coordinated packages from `0.18.0` to the
validated `v0.17.0` tag. No database rollback, provider revocation or data repair is involved.
