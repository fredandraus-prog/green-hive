# Green Hive

Green Hive is the reusable platform foundation for BeeGreen applications. This repository contains
the canonical GH-0/GH-1 bootstrap advanced through **GH-0102 (Database Foundation)**,
**GH-0103 (RLS and isolation)**, **GH-0104 (Project Service)** and the local implementation of
**GH-0201/GH-0202 (Auth, accounts and the protected HTTP boundary)**. Version `0.7.0` completed
**GH-0203 (Audit Foundation)** after **GH-0250 (Organizations & Multi-Tenancy Foundation)**.
Version `0.8.0` completes the deployed HTTPS/Auth/RLS acceptance gate for **GH-0201/GH-0202**;
version `0.9.0` completes **GH-0204 (Security Baseline)** after bounded application-level limits,
hardened headers and secret/bundle guards pass locally and on the exact Render HTTPS service.
Version `0.10.0` completes **GH-0301 (Billing Foundation)** with an app-scoped catalog,
versioned exact-decimal prices and tenant-isolated pending purchases/payments. Version `0.11.0`
completes **GH-0302 (Sandbox Billing Provider)** with deterministic success, failure and full-refund
transitions behind a trusted server-only boundary. Version `0.12.0` completes **GH-0303 (Verified
Idempotent Webhooks)** with exact-body HMAC verification, replay protection, provider-event
deduplication and authoritative reconciliation.

The checkpoint is deliberately narrow. The only public Billing ingress is the verified fake-provider
webhook used to prove the platform contract. Real payment-provider adapters, checkout UI,
Entitlements, Cost Guard, AI, Search, Redis, remote storage and consumer-domain functionality remain
out of scope.

## What this checkpoint contains

- the 18 canonical `@green-hive/*` packages, `hive-reference-app` and `hive-admin`;
- canonical `AppManifestV1`, validator, App Registry and complete `REFERENCE_APP` manifest;
- schemas `hive`, `audit` and `reference_app`;
- fifteen immutable migrations and a SHA-256 migration ledger;
- organizations, memberships and tenant app installations around the global app registry;
- tenant-scoped `projects` and `project_settings`;
- production-safe structural seeds containing only `REFERENCE_APP` and its manifest-registered
  zero-value sandbox catalog item;
- Supabase-native trusted context through `auth.uid()` and `auth.jwt()`;
- owner/workspace/app isolation, operational-only platform administration and logical deletion;
- typed `@green-hive/projects` service with create/list/get/archive/soft-delete operations;
- typed `@green-hive/auth` services for signup, login, refresh, logout, password recovery and
  account profiles;
- server-only Supabase Auth adapter with exact redirect allowlisting and stable public errors;
- a Reference App server facade that derives owner/app scope exclusively from a verified session;
- automatic personal workspaces, shared-workspace creation and bounded member roles;
- append-only `audit.events`, transactionally captured lifecycle events and correlation IDs;
- typed tenant audit reader plus a payload-minimized Reference App activity view;
- typed `@green-hive/billing` catalog/purchase service with runtime validation, exact decimal
  snapshots, hashed idempotency keys and stable public errors;
- app-scoped products, immutable-version prices, tenant purchases and limited-read payment records,
  with no authenticated direct-write grants and no payment-card storage;
- a deterministic, network-free Billing sandbox adapter plus server-only, idempotent
  success/failure/full-refund transitions and safe payment Audit events;
- a provider-neutral webhook verifier/processor, HMAC fake-provider adapter, minimal verified-event
  ledger and exact duplicate single-effect enforcement;
- a responsive React/Vite Reference App with signup, login, recovery, profile and project screens;
- a loopback-only Fastify HTTP boundary with HttpOnly cookies, exact-origin CSRF checks, PKCE
  recovery, no-store responses and baseline security headers;
- HMAC-keyed fixed-window limits for Auth, session, API and expensive reads, with wider source and
  global ceilings, bounded memory, lazy expiry, stable `429` responses and unthrottled health probes;
- a fail-closed hosted staging mode, Free Render Blueprint, fingerprint-pinned Supabase CA,
  database-backed readiness endpoint, GitHub CI and repository secret scan;
- runtime validation, explicit trusted-context authorization and stable public project errors;
- static, unit, embedded PostgreSQL and guarded local Supabase/PostgreSQL/Auth parity tests.

## Clean verification

```text
npm ci
npm run verify
```

`verify` removes generated outputs, checks formatting and platform boundaries, type-checks, builds
all workspaces, validates migration integrity and runs the embedded RLS matrix.

Database deployment requires a dedicated connection:

```text
set DATABASE_URL=postgresql://...
npm run db:validate
npm run db:migrate
npm run db:seed
```

Connection strings belong in a secret manager or an untracked local environment file.

The repository also carries a versioned Supabase CLI and an isolated local gate:

```text
npm run supabase:start
npm run supabase:status
npm run db:test:supabase
npm run auth:test:supabase
npm run web:test:supabase
npm run verify:supabase
npm run supabase:stop
```

The local stack starts PostgreSQL, Supabase Auth and Mailpit. Auth and Mailpit are recreated with
explicit `127.0.0.1` bindings; PostgreSQL remains protected by the required Windows firewall rule.
See [Local Supabase](docs/LOCAL-SUPABASE.md) for the network boundary and destructive-test
safeguards.

## Hosted staging workflow

A dedicated Free-plan Supabase staging project is active in São Paulo. Its fifteen-migration database
baseline, cross-organization RLS matrix, Project/Workspace Service and server-side Auth core have
passed without changing the production
candidate or the pre-existing Green Hive project:

```text
npm run staging:database:preflight
npm run staging:database:apply
npm run staging:database:test
npm run staging:auth:test
```

The Windows wrapper obtains user-bound encrypted credentials from the machine-local Engine
`.secrets` directory beside this repository, uses the session pooler with official CA verification,
and clears its process variables after each command. The apply command never resets or drops a
remote schema; it applies only the canonical migrations and structural seed. Remote tests remove
only their disposable users and rows. The Free Render service is live with fully verified database
TLS, exact-origin secure cookies and database-backed readiness. Supabase Auth uses the exact HTTPS
recovery callback and the dedicated Mailtrap sandbox as custom SMTP. The public smoke and complete
disposable hosted acceptance matrix pass, including PKCE recovery and cleanup. See
[Hosted staging](docs/HOSTED-STAGING.md) and
[Dedicated Supabase staging](docs/STAGING-SUPABASE.md).

The committed Blueprint builds only the application; startup never applies migrations or seed.
The public read-only gate is:

```powershell
$env:GREEN_HIVE_HOSTED_APP_ORIGIN = "https://green-hive-staging.onrender.com"
npm run hosted:smoke
Remove-Item Env:GREEN_HIVE_HOSTED_APP_ORIGIN
```

The guarded authenticated gate is intentionally interactive only for the one-time recovery link
inside the Mailtrap sandbox and cleans all test-owned rows and Auth users:

```text
npm run hosted:acceptance
```

## Working local preview

With Docker Desktop running, one command prepares the database, builds the web application and
starts the complete Reference App:

```text
npm run reference-app:start
```

Open `http://127.0.0.1:3000`. The server is bound only to loopback. The recovery page is available
at `http://127.0.0.1:3000/auth/recovery`, and development recovery messages can be inspected at
`http://127.0.0.1:54324`. Stop the Reference App with `Ctrl+C`; use `npm run supabase:stop` when the
local database is no longer needed.

## Authentication model

Passwords are handled only by Supabase Auth. The Green Hive server verifies access tokens with the
Auth server, reads app and platform role only from trusted `app_metadata`, then creates a minimal
`TrustedAppContext`. The service-role key exists only inside the server adapter and is never part of
client configuration.

The Reference App proves signup, login, refresh, local/global logout, PKCE password recovery,
profile management and owned-project access through a real browser/server boundary. Access and
refresh tokens are never returned to the React application or stored in browser-accessible
storage; they remain in HttpOnly, same-site cookies.

## Authorization model

Project access requires all of the following:

```text
auth.uid() = projects.owner_user_id
AND
auth.jwt().app_metadata.app_code resolves to projects.app_id
AND
hive.current_organization_id() = projects.organization_id
AND
the app is actively installed in the selected organization
AND
projects.status <> DELETED
```

`user_metadata`, request payloads, arbitrary headers, query strings and environment variables are
not authorization sources. A workspace cookie is only a preference until the server validates an
active membership in the database transaction. `PLATFORM_ADMIN` can read app, organization and
installation metadata but cannot automatically read private profiles, projects or settings.
Logical deletion is exposed through `hive.soft_delete_project(uuid)`; authenticated users receive
no physical project `DELETE` grant.

## Audit model

`audit.events` is append-only for authenticated users. PostgreSQL triggers capture organization,
membership, app-installation and project-lifecycle changes inside the same transaction as the
domain operation, preventing successful writes without their corresponding event. Repeated
idempotent archive/delete/provisioning calls do not create duplicate lifecycle events.

Each event carries a request and correlation ID, actor identity/type, organization, app, optional
project, outcome and bounded operational metadata. Project names, arbitrary project metadata,
documents, prompts, credentials, cookies, tokens and raw payloads are not recorded. Workspace
members can read only events for the selected organization and app. Platform administrators can
read the same safe operational event shape but do not gain access to private profile, project or
settings content.

## Billing model

Billing records commercial truth and never grants product capabilities. `hive.products` and
`hive.prices` form an app-scoped catalog; every price is versioned and its `numeric(20,6)` value is
returned to TypeScript as an exact decimal string. `hive.purchases` snapshots product code, price
version, amount and currency so later catalog changes cannot rewrite historical commercial state.

An authenticated owner can request only `projectId`, `productCode`, `priceId` and a bounded
idempotency key. `hive.create_pending_purchase(...)` derives the user, app and workspace from
trusted Supabase context, validates an owned non-deleted project, resolves the active price and
atomically creates one `PENDING` purchase plus one `PENDING` payment attempt. Raw idempotency keys
are not retained. Authenticated users have no direct insert/update/delete grant on catalog,
purchases or payments and cannot read provider references. GH-0302 adds a deterministic
`GREEN_HIVE_FAKE` adapter whose outcome is server configuration, never request input. Only the
trusted backend can apply verified success, failure and full-refund results; exact retries have one
effect. GH-0303 adds `POST /api/webhooks/payments/{provider}`. The fake adapter verifies an HMAC of
the exact raw body with a bounded timestamp before parsing; the server hashes but never retains the
raw body or signature. `hive.apply_verified_payment_webhook(...)` locks the commercial rows and
records `(provider_code, provider_event_id)` once. Exact redelivery increments only a delivery
counter; identity reuse with different content is rejected. Authenticated clients cannot read the
provider-event ledger or execute the transition. `BillingService.reconcilePayment(...)` queries the
provider adapter and applies only a runtime-validated authoritative result.

## Migration discipline

Applied migrations are immutable. The ledger records sequence, filename, checksum and rollback
strategy. `db:migrate` refuses gaps, unknown versions, renamed files, checksum drift, rollback
metadata drift and a managed schema without a ledger. Except for provisioning the shared
`pgcrypto` extension, managed objects do not use `IF NOT EXISTS`.

## Status

GH-0102, GH-0103, GH-0104, GH-0201, GH-0202, GH-0203, GH-0204, GH-0250, GH-0301, GH-0302 and GH-0303 are
`DONE`.
GH-0204 passed local abuse/bundle tests, the exact hosted security smoke and the complete
authenticated HTTPS acceptance matrix on the single-instance Render staging service. See
[Implementation status](docs/IMPLEMENTATION_STATUS.md), [Database](docs/DATABASE.md), [Trusted app
context](docs/TRUSTED-APP-CONTEXT.md), [Auth and accounts](docs/AUTH-ACCOUNTS.md), [Project
Service](docs/PROJECT-SERVICE.md), [Workspace Service](docs/WORKSPACE-SERVICE.md), [Reference App
web](docs/REFERENCE-APP-WEB.md), [Hosted staging](docs/HOSTED-STAGING.md), [Audit](docs/AUDIT.md),
[GH-0203 checkpoint](docs/CHECKPOINT-GH-0203.md), [GH-0204 checkpoint](docs/CHECKPOINT-GH-0204.md),
[GH-0204 release validation](docs/VALIDATION-2026-08-23-GH0204-RELEASE.md),
[GH-0301 checkpoint](docs/CHECKPOINT-GH-0301.md),
[GH-0301 release validation](docs/VALIDATION-2026-08-23-GH0301-RELEASE.md),
[GH-0302 checkpoint](docs/CHECKPOINT-GH-0302.md),
[GH-0302 implementation validation](docs/VALIDATION-2026-08-23-GH0302-IMPLEMENTATION.md),
[GH-0302 release validation](docs/VALIDATION-2026-08-23-GH0302-RELEASE.md),
[GH-0303 checkpoint](docs/CHECKPOINT-GH-0303.md),
[GH-0303 implementation validation](docs/VALIDATION-2026-08-23-GH0303-IMPLEMENTATION.md),
[GH-0250 checkpoint](docs/CHECKPOINT-GH-0250.md), [Ideas Radar](IDEAS_RADAR.md) and
[Reconciliation](docs/RECONCILIATION-2026-08-18.md).
