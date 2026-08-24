# GH-0303 - Verified idempotent webhook processing

Status: `DONE` in platform `0.12.0`.

## Delivered boundary

GH-0303 adds one provider-neutral server ingress and keeps payment state authoritative on the
server. The slice includes:

- immutable migration `0015_create_verified_payment_webhooks.sql`;
- `hive.payment_provider_events` with unique provider/event identity and minimal retention;
- locked `hive.apply_verified_payment_webhook(...)` paid, failed and full-refund transitions;
- `BillingWebhookVerifier`, `BillingWebhookService` and `BillingWebhookRepository` contracts;
- `FakeBillingWebhookVerifier` with exact-body HMAC-SHA256 and timestamp replay protection;
- `PostgresBillingWebhookRepository` with stable public error mapping;
- `BillingProvider.reconcilePayment(...)` and `BillingService.reconcilePayment(...)`;
- `POST /api/webhooks/payments/{provider}` with a minimal `202` response;
- embedded and native Supabase duplicate/concurrency/Audit matrices.

No real provider, checkout frontend, payment-card processing or Entitlement grant is included.

## Verification sequence

For `GREEN_HIVE_FAKE`, the sender computes:

```text
HMAC_SHA256(secret, unix_timestamp + "." + exact_raw_request_body)
```

and sends:

```text
X-Green-Hive-Signature: t=<unix_timestamp>,v1=<lowercase_hex_digest>
Content-Type: application/json
```

The adapter validates the header, rejects timestamps outside five minutes, compares digests in
constant time and only then decodes strict UTF-8/JSON. Extra fields are rejected. The normalized
event contains only provider/event identity, event type, purchase ID, payment reference and the
event-specific refund reference or failure code.

## Idempotency and state

The PostgreSQL function serializes processing on the purchase/payment rows. The first verified
event records its unique `(provider_code, provider_event_id)` identity and applies exactly one of:

- `PAYMENT_PAID` -> purchase `CONFIRMED`, payment `PAID`;
- `PAYMENT_FAILED` -> purchase `CANCELED`, payment `FAILED`;
- `PAYMENT_REFUNDED` -> payment `REFUNDED`, purchase retained as `CONFIRMED`.

An exact redelivery updates only `delivery_count` and `last_received_at`. A duplicate identity with
different body hash, event type, purchase or provider reference raises
`BILLING_WEBHOOK_IDEMPOTENCY_CONFLICT`. A later distinct provider event that agrees with already
authoritative state is retained as `NO_CHANGE`; it does not create another payment Audit event.

## Security and privacy

- `PUBLIC` and `authenticated` cannot execute the transition function;
- authenticated users cannot select or mutate provider-event rows;
- the event table uses forced RLS with no client policy;
- browser Origin, cookies, query strings and client scope fields are not authorization inputs;
- raw request bodies and signatures are never stored;
- only SHA-256, bounded normalized references, effect and delivery metadata are retained;
- webhook requests have a dedicated source-scoped rate limit;
- public errors contain no SQL, stack, secret or provider internals.

The HMAC secret is a server-only 32-64 byte base64url value. Local development uses an explicit
non-production placeholder. Hosted values belong only in the Render secret store.

## Reconciliation

Webhook delivery is not assumed to be complete. `reconcilePayment` asks the configured provider for
the current authoritative state, validates the returned discriminated result and applies it through
the existing trusted transition boundary. It accepts no caller-selected outcome, provider ID,
amount, owner, app or workspace.

## Recovery

Migration `0015` has no destructive automatic `DOWN`. Prefer a next-numbered forward fix. Before
controlled restoration, export and verify provider-event identities, purchases, payments and
payment Audit events. Never delete an event identity to force a duplicate to run again without a
reviewed reconciliation record.

## Deferred

- real-provider signature adapters and secret rotation;
- provider-specific retry schedules and reconciliation jobs;
- checkout and payment UI;
- partial refunds and disputes beyond the existing schema states;
- GH-0304 Entitlements and every capability grant.
