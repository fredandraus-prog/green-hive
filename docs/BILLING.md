# Billing Foundation

## Boundary

Billing answers what was selected, purchased and paid. It does not decide what a project may use;
that remains the Entitlements boundary. GH-0301 adds provider-neutral commercial state; GH-0302
adds a deterministic sandbox adapter and trusted success/failure/full-refund transitions. It does
not connect a real payment provider, expose a checkout/webhook endpoint or grant an Entitlement.

## Public TypeScript surface

`@green-hive/billing` exports:

- `Product`, `Price`, `Purchase` and `PaymentSummary`;
- canonical `ProductType`, `PurchaseStatus` and `PaymentStatus` unions;
- `CreatePurchaseInput` with only `projectId`, `productCode`, `priceId` and `idempotencyKey`;
- `BillingRepository`, `PostgresBillingRepository` and `BillingService`;
- `BillingProvider`, payment/refund request and runtime-validated result contracts;
- `FakeBillingProvider` with server-configured `SUCCESS` or `FAILURE` behavior;
- stable `BillingError` codes and runtime validators.

`BillingService` exposes `listCatalog`, `getProduct`, `createPurchase`, `listPurchases` and
`getPurchase`, plus `processPayment` and `refundPayment` when a provider is injected. All
operations require a `TrustedOrganizationContext` derived from a verified server-side session.
Platform administrators cannot reuse owner commands.

## Catalog

`hive.products` belongs to a registered app through `app_id`. Product codes use the same uppercase
namespace contract as the App Manifest. Supported product types are:

- `ONE_TIME`;
- `REANALYSIS_OR_REPROCESS`;
- `SUBSCRIPTION`;
- `INTERNAL_GRANT`.

`hive.prices` belongs to one product and app through a composite foreign key. A price has a positive
version, ISO-style three-letter currency, optional locale, validity window and `numeric(20,6)`
amount. TypeScript receives the amount as a string and must never convert it to a floating-point
number.

The operational seed adds only the manifest-registered `REFERENCE_APP_SANDBOX` product and one
zero-value `BRL` sandbox price. Both have deterministic UUIDs and fail on an incompatible existing
identity. The zero value is not a production commercial decision.

## Purchase transaction

`hive.create_pending_purchase(project_id, product_code, price_id, idempotency_key)` is the only
authenticated write entrypoint in GH-0301. It:

1. reads the user from `auth.uid()`;
2. reads the app and workspace through trusted helpers;
3. rejects platform administrators and incomplete context;
4. requires an owned `DRAFT` or `ACTIVE` project in that app/workspace;
5. resolves the active product and exact price in PostgreSQL;
6. hashes the bounded idempotency key with native PostgreSQL SHA-256;
7. inserts one immutable-snapshot `PENDING` purchase;
8. inserts one matching `PENDING` payment attempt in the same transaction;
9. returns the existing purchase for an exact retry;
10. rejects reuse of the key for a different project/product/price.

The function is `SECURITY DEFINER` only because authenticated users have no table write grants. It
has an empty `search_path`, schema-qualified names, an explicit `PUBLIC` revocation and complete
authorization checks before writing.

## Sandbox provider and transitions

`FakeBillingProvider` is deterministic and performs no network request. Its result is selected by
server configuration when the provider instance is created; no service method or consumer payload
accepts an outcome, provider code, provider reference, amount, owner, app or workspace override.
It returns opaque IDs derived from the internal payment UUID so exact retries are reproducible.

The trusted backend applies runtime-validated provider results through:

- `hive.apply_provider_payment_result(...)` for `PENDING -> PAID/CONFIRMED` or
  `PENDING -> FAILED/CANCELED`;
- `hive.apply_provider_refund(...)` for a full `PAID -> REFUNDED` transition while retaining the
  original purchase as `CONFIRMED` commercial history.

These `SECURITY DEFINER` functions are revoked from `PUBLIC` and `authenticated` and granted only
to the server role when that role exists. They still require `auth.uid()` plus trusted app and
workspace context, reject platform-admin command reuse, lock the purchase/payment rows and allow
only an exact idempotent retry. A different result or provider reference after transition is
rejected. Authenticated clients therefore cannot promote their own pending payment even if they
know every row UUID.

## Commercial snapshots and privacy

Purchases retain product code, product/price IDs, price version, exact amount and currency. Later
catalog changes cannot rewrite that history. Payments retain opaque provider payment/refund
references and an exact refunded amount. Authenticated column grants exclude provider references
and failure internals but allow the non-sensitive lifecycle state and refunded amount.

Green Hive never stores full card numbers, CVV/CVC or provider credentials. Raw idempotency keys
are not stored. The `PURCHASE_CREATED` Audit event contains only product code, price version and
pending status. Payment transition events contain only provider code, resulting state and an
optional failure code. They exclude amount, provider IDs, idempotency material, credentials and
payloads.

## RLS and grants

- authenticated users read active catalog rows only for the current app and a trusted workspace;
- owners read purchases/payments only for an accessible project in the current app/workspace;
- platform administrators can inspect catalog metadata but not owner purchase/payment rows;
- authenticated users have no direct `INSERT`, `UPDATE` or `DELETE` grant on Billing tables;
- authenticated payment reads omit provider references and failure internals;
- authenticated users cannot execute the payment-result or refund functions;
- the trusted backend rechecks the same user/app/workspace authority before applying a result;
- physical deletion is not granted.

The embedded and native Supabase matrices cover cross-user, cross-workspace and cross-app denial,
forged commercial fields, direct payment mutation/function execution, hashed idempotency, seed
conflicts, deterministic success/failure/refund, exact and conflicting retries, Audit capture and
cleanup ordering.

## Deferred checkpoints

- GH-0303: verified, idempotent provider webhooks and reconciliation;
- GH-0304: Entitlements derived through a reviewed Billing/Entitlement transaction boundary.

No frontend checkout or public HTTP Billing endpoint is added in GH-0302. The service remains a
server-side library; real-provider and webhook ingress begin only in GH-0303.
