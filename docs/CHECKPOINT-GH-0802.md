# GH-0802 — Structured logs, correlation and provider metrics

## Delivered implementation

- `@green-hive/observability` defines a strict, immutable structured HTTP event and safe sink.
- The Reference App creates an unforgeable UUID per request, returns it as `X-Request-Id` and uses
  it as the server-side correlation identity.
- Hosted logs contain only the closed operation class, outcome, duration, status, public error code
  and the normalized payment-webhook provider code where applicable.
- Fastify automatic request logs are suppressed because they can contain raw URLs; one safe event
  is emitted after a response instead.
- Observability failures never change a response or side effect.

## Security boundary

No telemetry accepts client correlation values or stores account/tenant identifiers, URLs, query
parameters, payloads, cookies, tokens, prompts, raw provider events, signatures, stack traces or
arbitrary exception messages. This checkpoint creates no customer-facing endpoint, no persistence,
no cross-tenant read path and no external monitoring account.

## Release gate

**Status: DONE — 2026-09-07.**

Focused unit/HTTP validation proves a failed Authentication request is correlated without recording
its e-mail, password or query parameter, and a failed webhook is correlated by public error code
and normalized provider code without raw provider-event retention. Pull-request CI passed before
merge. The exact published Render service then returned `401 AUTH_SESSION_INVALID` for one
unauthenticated administrative request and its returned `X-Request-Id` matched one structured
`ADMIN` / `DENIED` / `401` event in the Render log. The event retained no URL, identity, cookie,
token, payload or tenant data.
