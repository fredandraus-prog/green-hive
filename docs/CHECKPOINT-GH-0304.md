# GH-0304 - Entitlements

Status: `DONE` in platform `0.13.0`.

## Delivered boundary

GH-0304 separates commercial state from capability authorization and delivers:

- immutable migration `0016_create_project_entitlements.sql`;
- reviewed product-to-capability mappings and purchase-derived project grant snapshots;
- a manifest-verified, deterministic and reapplicable `REFERENCE_APP` entitlement seed;
- transactional grant after paid/confirmed Billing state and revocation after full refund;
- independent grant retention when another paid purchase remains active;
- server-authoritative `hive.can_project_capability(uuid,text)`;
- typed `@green-hive/entitlements` service, PostgreSQL repository, validation and safe errors;
- a protected Reference App capability-decision endpoint;
- Entitlement Audit events with bounded metadata;
- embedded and native Supabase service/RLS matrices.

The `REFERENCE_APP` product manifest remains `0.1.0`. Platform packages advance together to
`0.13.0`.

## Security decisions

- grant scope is derived only from trusted user/app/workspace context and immutable Billing rows;
- authenticated users cannot write grants or invoke the internal synchronizer;
- `can()` repeats project ownership, app, workspace, project-state, mapping and manifest checks;
- a client cannot fabricate administration through `user_metadata` or payload fields;
- platform administration is read-only operational inspection and is not an owner command path;
- forced RLS and column-level grants protect both Entitlement tables;
- public errors do not reveal SQL, stack traces, provider references or foreign resource existence.

## Acceptance evidence

- 97 unit tests pass, including service validation, stable errors and the HTTP decision route;
- 15 embedded database tests pass, including Billing/Webhook regression coverage and GH-0304;
- `db:validate` verifies 16 immutable migrations, 16 RLS-protected tables and three isolated seeds;
- the native local Supabase gate applies/reapplies all migrations and seeds, verifies grants/helpers,
  passes all prior service matrices plus six GH-0304 scenarios and restores a clean baseline;
- dedicated staging and published HTTPS evidence are recorded in the
  [GH-0304 release validation](VALIDATION-2026-08-24-GH0304-RELEASE.md).

## Recovery

Migration `0016` has no destructive automatic `DOWN`. Prefer a new forward migration. Before any
controlled restoration, export and verify product mappings, grant snapshots, their purchase/payment
sources and Entitlement Audit events. Never delete or reactivate a grant directly to compensate for
an incorrect commercial state; correct Billing truth first and reconcile through the reviewed
boundary.

## Deferred

Real providers, checkout UI, internal/manual grants, subscriptions, usage accounting, Cost Guard,
Jobs, AI, Redis, Files and domain execution remain outside GH-0304.
