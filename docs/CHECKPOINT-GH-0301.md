# GH-0301 - Billing Foundation

Status: `DONE` in platform `0.10.0`.

## Delivered

- immutable migrations `0012_create_billing_catalog.sql` and
  `0013_create_purchases_and_payments.sql`;
- `hive.products`, `hive.prices`, `hive.purchases` and `hive.payments`;
- manifest-aligned canonical product-type validation;
- deterministic `REFERENCE_APP_SANDBOX` product and price seed;
- exact-decimal price and purchase snapshots;
- hashed idempotency and atomic pending purchase/payment creation;
- app/workspace/project/owner composite foreign-key boundaries;
- forced RLS, limited authenticated column grants and no direct Billing writes;
- transactional `PURCHASE_CREATED` Audit capture with allowlisted metadata;
- typed `@green-hive/billing` service, PostgreSQL repository, runtime validators and stable errors;
- embedded PostgreSQL, native local Supabase and dedicated staging matrices.

## Acceptance

- a current-app catalog and price version can be listed;
- an owner creates one pending purchase/payment for an owned active project;
- an exact retry returns the same purchase and payment;
- conflicting idempotency reuse is rejected;
- caller-provided owner, app, workspace, amount, currency or status is rejected;
- cross-user, cross-workspace and cross-app access returns no commercial data;
- direct table writes and provider-reference reads are denied;
- platform admin can read catalog metadata but cannot reuse owner purchase commands;
- raw idempotency keys and payment-card data are absent;
- a safe Audit event is committed with the purchase;
- seeds are repeatable and incompatible identities fail explicitly;
- all previous Auth, Project, Workspace, Audit and Security gates remain green.

## Not delivered

- real or sandbox provider integration;
- payment confirmation/failure/refund commands;
- provider webhook endpoint or signature verification;
- provider reconciliation;
- checkout frontend or public checkout API;
- Entitlement grants;
- real prices or production commercial configuration.

Those items remain GH-0302, GH-0303 and GH-0304. Billing state must never be treated as an
Entitlement decision.

## Recovery

Published migrations are never edited. Catalog corrections use a new forward migration. Before a
commercial-ledger recovery, export and verify products, price versions, purchases, payments and
their Audit events together. Destructive `DOWN` scripts are intentionally absent.

See [Billing Foundation](BILLING.md), [Database](DATABASE.md),
[Migration recovery strategies](ROLLBACK-STRATEGIES.md) and the release validation record.
