# GH-0802 — Observability Foundation

Green Hive exposes a small operational telemetry contract for the Reference App HTTP boundary.
It is designed to make a failing request traceable in the hosting log without becoming analytics,
tenant inspection or a second Audit store.

## Event shape

Every completed HTTP request produces at most one structured JSON event with:

- server-generated `requestId` and matching `correlationId` (both UUIDs);
- a closed, normalized operation class such as `AUTH`, `PROJECT`, `PAYMENT_WEBHOOK` or `WEB`;
- `SUCCEEDED`, `DENIED` or `FAILED` outcome;
- bounded integer duration and HTTP status;
- the already-public error code when a response failed; and
- a normalized provider code only for payment-webhook processing.

The request identifier is returned as `X-Request-Id`, so a user report can be matched to one
hosted event without accepting a browser-provided correlation value.

## Deliberate privacy boundary

The contract rejects paths, query strings, route identifiers, user and organization IDs, e-mail,
cookies, access/refresh/recovery tokens, request bodies, prompts, raw provider events, signatures,
stack traces and arbitrary error messages. Fastify's default per-request logging is disabled; only
the reviewed event shape is emitted when `GREEN_HIVE_HTTP_LOGS=true`.

The sink is fail-open: an unavailable logger never changes the application response, authorization
decision or billing/webhook effect.

## Operations

In hosted staging, use the `X-Request-Id` from a failed response to find the corresponding
`green_hive_observability` JSON record in Render logs. The record is diagnostic evidence only;
it must not be copied into product UI, Audit events or a tenant-visible endpoint.

The GH-0802 release gate requires a normal deployed HTTPS failure to yield a matching redacted
record. It does not require a third-party log provider, paid monitoring plan, trace exporter or
retention service.
