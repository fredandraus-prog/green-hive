# GH-0302 - Sandbox Billing Provider

Status: `DONE` in platform `0.11.0`.

## Delivered scope

- immutable migration `0014_create_sandbox_payment_transitions.sql`;
- provider-neutral `BillingProvider` request/result contracts with runtime result validation;
- deterministic, network-free `FakeBillingProvider` configured on the server as `SUCCESS` or
  `FAILURE`;
- `BillingService.processPayment(...)` and `BillingService.refundPayment(...)`;
- server-only `hive.apply_provider_payment_result(...)` and `hive.apply_provider_refund(...)`;
- exact refunded amount and opaque refund reference on `hive.payments`;
- transactional `PAYMENT_CONFIRMED`, `PAYMENT_FAILED` and `PAYMENT_REFUNDED` Audit capture;
- unit, embedded PostgreSQL, native local Supabase and dedicated staging coverage.

## Authority boundary

An authenticated owner can create and read a pending purchase through the GH-0301 contract, but
cannot mutate a payment or execute either GH-0302 transition function. The trusted backend must
carry verified user, app and workspace context even when its database role can execute those
functions. Both functions repeat authorization, lock the commercial rows and reject conflicting
retries.

The sandbox outcome is constructor configuration inside the server. It is not accepted from an
HTTP body, header, query string, service command or `user_metadata`. Provider result objects are
runtime validated before PostgreSQL sees them.

## Lifecycle

```text
PENDING purchase/payment
  -> success -> CONFIRMED purchase + PAID payment
  -> failure -> CANCELED purchase + FAILED payment

CONFIRMED purchase + PAID payment
  -> full refund -> CONFIRMED purchase + REFUNDED payment
```

The confirmed purchase remains immutable commercial history after refund. Exact retries return the
existing state and do not create duplicate Audit events. A different provider reference or result
after the first transition is rejected.

## Privacy and Audit

Authenticated reads expose payment status, timestamps and exact refunded amount but not provider
payment/refund IDs or failure internals. Audit metadata is limited to provider code, resulting
status and optional failure code. Amounts, opaque provider IDs, credentials, card data and raw
payloads are prohibited.

## Acceptance result

- deterministic sandbox success: passed;
- deterministic sandbox failure: passed;
- full refund after payment: passed;
- exact retry has one effect: passed;
- conflicting transition/refund: denied;
- direct authenticated transition/function execution: denied;
- cross-user, cross-workspace and cross-app access: denied;
- platform-admin owner command reuse: denied;
- local and dedicated staging Supabase matrices: passed;
- disposable staging fixtures after the matrix: zero.

## Explicitly deferred

- real payment provider integration;
- frontend checkout and public Billing HTTP endpoints;
- signed provider webhook ingress, event deduplication and reconciliation (`GH-0303`);
- Entitlements and capability decisions (`GH-0304`);
- partial refund, dispute and chargeback workflows.

Billing records commercial truth only. It still cannot grant a product capability.
