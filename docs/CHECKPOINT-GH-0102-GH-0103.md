# GH-0102 / GH-0103 acceptance record

## Implemented and validated

- [x] three required schemas and `pgcrypto` provisioning;
- [x] six sequential migrations with parseable metadata;
- [x] checksum ledger, drift detection and fresh-database safeguard;
- [x] app registry, Supabase-linked profiles, projects and settings;
- [x] complete `REFERENCE_APP` seed with immutable UUID;
- [x] structural seeds separated from disposable fixtures;
- [x] `auth.uid()` and signed `app_metadata.app_code` trusted context;
- [x] owner isolation and read-only platform administration;
- [x] logical deletion with retained project/settings data;
- [x] cross-user, cross-app, forged-payload and metadata-elevation tests;
- [x] clean npm installation, static validation, unit tests, embedded RLS suite and build;
- [x] external parity gate on Supabase local PostgreSQL 17.6 with native Auth helpers.

## Status interpretation

GH-0102 and GH-0103 are `DONE`. The gate applied the six canonical migrations from an empty managed
state, verified reapplication, seeded twice, exercised ledger drift and the complete RLS matrix,
cleaned only test-owned objects, then restored a migrated and seeded baseline. The SQL RLS layer
advances part of GH-0202, but GH-0202 remains `PARTIAL` until authentication, API and service
integration are implemented and tested.

## Explicitly deferred

Billing, Entitlements execution, Cost Guard, AI/Search gateways, Redis, queues, webhooks, remote
storage and all consumer-domain tables. Project Service begins only in GH-0104.
