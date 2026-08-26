# Changelog

All notable Green Hive changes are recorded here. Internal platform packages use coordinated
semantic versioning.

## [Unreleased]

No unreleased changes.

## [0.16.0] - 2026-08-26

### Added

- GH-0403 `@green-hive/jobs` contracts, runtime validation, stable public errors, PostgreSQL
  repository and server-side enqueue/read service.
- Immutable migration `0019` with manifest-backed job registrations and a tenant-safe PostgreSQL
  queue that persists only opaque input references and SHA-256 identities.
- Exact idempotent enqueue, entitlement gating, bounded priority, registration snapshots,
  correlation IDs and transactional `JOB_QUEUED` Audit capture.

### Security

- User, app, workspace, project and owner are derived exclusively from trusted server context and
  revalidated inside the protected enqueue function.
- Authenticated clients cannot enqueue directly or insert, update or delete queue rows. Owners and
  read-only platform administrators receive only a sanitized status projection through forced RLS.
- Raw job payloads and raw idempotency keys are not stored. Audit excludes hashes and input
  references.

### Scope

- GH-0403 creates only registered `QUEUED` jobs. Claim, execution, retry, completion, failure and
  cancellation transitions remain explicitly owned by GH-0404 Workers.
- No Redis, message broker, external provider, AI execution or Reference App domain handler is
  included.

### Validation

- 107 unit tests and 18 embedded database scenarios pass with the clean verification gate.
- The guarded local Supabase gate applies/reapplies all 19 migrations, reapplies all four seeds,
  runs the native Jobs isolation/idempotency matrix and retains a clean seeded baseline.
- Dedicated Supabase staging applied only migration `0019`, passed the full native database matrix
  and finished with 19 ledger rows, zero pending migrations and zero disposable test artifacts.

### Status

- GH-0403 is `DONE`; coordinated platform packages advance to `0.16.0` while the Reference App
  product manifest remains `0.1.0`.
- GH-0404 Worker claim/retry/failure lifecycle remains not started.

## [0.15.0] - 2026-08-24

### Added

- GH-0402 `@green-hive/cost-guard` decision contracts, strict runtime validation, stable public
  errors, PostgreSQL repository and server-side reserve/consume/release service.
- Immutable migration `0018` with append-only Cost Guard decisions, lifecycle-constrained cost
  reservations and exact-decimal atomic budget accounting.
- Entitlement-first `ALLOW`, `DENY_ENTITLEMENT` and `DENY_BUDGET` decisions, including the stable
  `BUDGET_EXHAUSTED` denial reason and operation-level idempotent replay.
- Atomic consumption that replaces the reservation with actual cost and writes the GH-0401 cost
  event in the same database transaction.

### Security

- User, app, workspace, project and capability scope is derived from the trusted session and
  repeated inside every privileged Cost Guard function; consumer payloads cannot override it.
- Budget rows are locked before the no-overspend decision. Concurrent estimates therefore cannot
  reserve more than the configured cost ceiling.
- Authenticated clients have no direct Cost Guard write or function-execution grants. Owners and
  read-only administrators receive only the bounded columns allowed by forced RLS.
- Audit capture stores the decision and non-confidential operational identity only; estimates,
  actual cost, provider data, operation IDs and idempotency material remain excluded.

### Validation

- 104 unit tests and 17 embedded database tests pass, including entitlement denial, exact replay,
  conflicting operation identity, terminal consume/release behavior and concurrent no-overspend.
- The native local Supabase gate applies/reapplies 18 migrations, passes the five-scenario Cost
  Guard matrix using separate PostgreSQL connections and restores a clean seeded baseline.
- Dedicated Supabase staging passes the same Cost Guard matrix and finishes with 18 ledger rows,
  zero pending migrations and zero disposable test artifacts.
- The complete clean `npm run verify` gate and dependency audit pass with no known vulnerability.
- GitHub CI passed both checks for feature PR #19 and readiness hotfix PR #20. Render rejected the
  first GH-0402 deploy because the application still expected 17 migrations; the minimal hotfix
  advanced readiness to 18 and verifies the Cost Guard tables/functions. Deploy
  `dep-da6djmbncjis738915rg` then succeeded on commit `325a7a4`, followed by public and hosted
  security smokes.

### Status

- GH-0402 is `DONE`; coordinated platform packages advance to `0.15.0` while the `REFERENCE_APP`
  product manifest remains `0.1.0`.
- GH-0403 Jobs and later checkpoints remain not started. No provider price estimation, provider
  selection, Jobs, AI, Search execution, Redis, remote Files or consumer-domain execution is added.

## [0.14.0] - 2026-08-24

### Added

- GH-0401 `@green-hive/cost-guard` Usage/Cost contracts, runtime validation, stable public errors,
  PostgreSQL repository and server-side service integration.
- Immutable migration `0017` with project-scoped exact-decimal budgets, separate append-only
  logical usage and monetary cost event ledgers, composite foreign keys and bounded metadata.
- Idempotent protected writers for budget configuration and accounting events, plus exact-decimal
  debit/credit usage aggregation without converting values to JavaScript floating point.
- Limited Reference App server reads for owner budgets, logical events and summaries, with no raw
  monetary-cost endpoint.

### Security

- Organization, app, project and owner scope is derived from the trusted JWT/session and repeated
  inside every privileged write function; payloads cannot provide those authority fields.
- Authenticated clients have no direct write or function-execution grants. Owners can read their
  budgets and logical usage only; raw monetary provider costs are visible only to read-only
  platform administration.
- Idempotency keys and request fingerprints are SHA-256 hashes, confidential metadata keys are
  rejected, event rows are append-only and no physical delete policy exists.

### Validation

- 101 unit tests and 16 embedded database tests pass, including exact decimals, idempotent replay,
  conflicting keys, debit/credit aggregation, cross-user/app/workspace denial and Audit minimization.
- The native local Supabase gate applies/reapplies 17 migrations and three seeds, passes the new
  five-scenario Usage/Cost matrix and restores a clean baseline.
- Dedicated Supabase staging passes the same matrix and finishes with 17 ledger rows, zero pending
  migrations and zero disposable test artifacts.
- GitHub CI passed both checks for PR #17; Render automatically deployed merge commit `15c2da2` as
  `dep-da697o3l550s73cd75bg`, and the public readiness plus hosted security smokes passed on the
  exact HTTPS staging origin.

### Status

- GH-0401 is `DONE`; coordinated platform packages advance to `0.14.0` while the `REFERENCE_APP`
  product manifest remains `0.1.0`.
- GH-0402 remains not started. No atomic reserve/consume/release decision, budget denial, real
  provider, Jobs, AI, Redis, remote Files or consumer-domain execution is included.

## [0.13.0] - 2026-08-24

### Added

- GH-0304 `@green-hive/entitlements` contracts, PostgreSQL repository, runtime validation and stable
  public errors for server-side project capability decisions.
- Immutable migration `0016` with reviewed product-capability mappings, purchase-derived project
  grant snapshots, transactional Billing synchronization and `hive.can_project_capability(...)`.
- Manifest-verified `REFERENCE_APP` mappings for `REFERENCE_APP_RUN_JOB` and
  `REFERENCE_APP_GENERATE_FILE`, plus the protected HTTP capability-decision route.
- Bounded `ENTITLEMENT_GRANTED` and `ENTITLEMENT_CHANGED` Audit capture.

### Security

- Grant scope comes only from verified user/app/workspace context, owned project state, immutable
  Billing snapshots, active product mappings and the canonical stored App Manifest.
- Authenticated users can execute `can()` but cannot insert/update/delete grants or execute the
  internal synchronizer; platform administration remains read-only operational inspection.
- Independent purchases keep independent grants, so one refund cannot remove access supplied by a
  second paid purchase. Malformed and cross-scope decisions fail without SQL or existence leakage.

### Validation

- 97 unit tests and 15 embedded database tests pass, including Billing/Webhook regressions,
  grant/revoke idempotency, multiple purchases and cross-user/app/workspace denial.
- The native local Supabase gate applies/reapplies 16 migrations and three seeds, passes the new
  six-scenario Entitlements matrix and restores a clean baseline.
- Dedicated staging, CI, deployed readiness and HTTPS authenticated acceptance are recorded in the
  GH-0304 release validation evidence.

### Status

- GH-0304 is `DONE`; coordinated platform packages advance to `0.13.0` while the `REFERENCE_APP`
  product manifest remains `0.1.0`.
- GH-0401 Usage/Cost Foundation and later checkpoints remain not started.

## [0.12.0] - 2026-08-23

### Added

- GH-0303 provider-neutral webhook verification/processing contracts, exact-body HMAC fake-provider
  adapter and a dedicated `POST /api/webhooks/payments/{provider}` server-to-server endpoint.
- Immutable migration `0015` with a minimal provider-event identity ledger and the locked,
  server-only `hive.apply_verified_payment_webhook(...)` transition.
- Provider-authoritative `BillingService.reconcilePayment(...)` and deterministic sandbox
  reconciliation outcomes for paid, failed and fully refunded state.

### Security

- Signatures are compared in constant time over the exact raw body and bounded provider timestamp;
  unsigned, malformed, tampered and replayed deliveries fail before state mutation.
- Exact duplicates increment only a delivery counter. Reuse of one provider event ID with different
  content or scope fails closed, including concurrent native PostgreSQL delivery.
- Raw webhook bodies and signatures are never stored. The SHA-256 digest and minimal normalized
  references are server-only under forced RLS with no authenticated policy or function execution.
- The webhook path does not trust browser Origin, cookies, caller app/workspace fields or
  `user_metadata`; all other mutating browser routes retain exact-origin CSRF enforcement.

### Validation

- 92 unit tests and 14 embedded database tests pass, including signature tampering/replay, strict
  payload shapes, exact/conflicting retries, paid/failed/refunded state and single Audit effects.
- The native local Supabase gate applies all 15 migrations twice safely, passes a concurrent
  duplicate webhook matrix and restores a clean seeded baseline with zero test fixtures.
- The dedicated Supabase staging matrix passes migration `0015`, RLS/grants, verified webhook
  concurrency and cleanup; the published HTTPS endpoint/readiness gate is covered separately.

### Status

- GH-0303 is `DONE`; coordinated platform packages advance to `0.12.0` while the `REFERENCE_APP`
  product manifest remains `0.1.0`.
- GH-0304 Entitlements is not started. Billing commercial state still grants no capability.

## [0.11.0] - 2026-08-23

### Added

- GH-0302 provider-neutral `BillingProvider` contract and deterministic, network-free
  `FakeBillingProvider` with server-configured success or failure behavior.
- Trusted, idempotent PostgreSQL transitions for payment success, failure and full refund, with
  exact-decimal refunded amounts and opaque provider references.
- Transactional `PAYMENT_CONFIRMED`, `PAYMENT_FAILED` and `PAYMENT_REFUNDED` Audit capture with
  bounded non-confidential metadata.

### Security

- Authenticated clients cannot execute provider-result/refund functions, mutate payment rows,
  choose the sandbox outcome or read provider payment/refund references.
- Transition functions repeat trusted user/app/workspace checks even behind the service role, use
  fixed `search_path`, lock commercial rows and reject conflicting retries.
- No external network, real payment provider, webhook, Billing HTTP endpoint, card data or
  Entitlement decision was added.

### Validation

- 87 unit tests and 13 embedded database tests pass, including deterministic success/failure,
  refund, idempotency, invalid provider output and no-network proofs.
- The native local Supabase and dedicated staging GH-0302 matrices pass all 7 scenarios; migration
  `0014` reapplies without duplication and staging retains zero disposable test fixtures.

### Status

- GH-0302 is `DONE`; coordinated platform packages advance to `0.11.0` while the
  `REFERENCE_APP` product manifest remains `0.1.0`.
- GH-0303 verified/idempotent webhooks and GH-0304 Entitlements remain not started.

## [0.10.0] - 2026-08-23

### Added

- GH-0301 app-scoped `products` and immutable-version `prices` with exact `numeric(20,6)` values.
- Tenant/project/owner-scoped `purchases` and limited-read `payments` with composite foreign keys,
  immutable commercial snapshots and no authenticated direct writes.
- `hive.create_pending_purchase(...)` for one atomic purchase/payment pair, exact retry and
  conflicting-idempotency rejection; only the SHA-256 idempotency hash is retained.
- Typed `@green-hive/billing` catalog/purchase service, PostgreSQL repository, runtime validation
  and stable public errors.
- Deterministic, manifest-verified `REFERENCE_APP_SANDBOX` zero-value catalog seed and
  transactionally captured `PURCHASE_CREATED` Audit events.

### Security

- App, workspace, project and owner scope are derived exclusively from the trusted Supabase
  context; caller-provided commercial authority fields are rejected.
- Billing tables use forced RLS and least-privilege column grants. Provider references are hidden
  from authenticated clients and full card number/CVV storage is prohibited.
- The reviewed `SECURITY DEFINER` purchase function has an empty `search_path`, schema-qualified
  objects, explicit `PUBLIC` revocation and no payment-state mutation surface.

### Validation

- 83 unit tests, 13 embedded database/service tests, the native local Supabase RLS matrix and the
  6-scenario native Billing Service matrix pass.
- Migration/seed reapplication, ledger drift, seed identity conflict, cross-user,
  cross-workspace, cross-app, forged amount/status and direct payment mutation are covered.
- The dedicated staging migration/RLS/Project/Workspace/Billing gates and Render readiness/smoke
  pass with all disposable fixture rows removed.

### Status

- GH-0301 is `DONE`; coordinated platform packages advance to `0.10.0` while the
  `REFERENCE_APP` product manifest remains `0.1.0`.
- GH-0302 fake/sandbox provider behavior, payment success/failure/refund, GH-0303 webhooks and
  GH-0304 Entitlements remain unimplemented.

## [0.9.0] - 2026-08-23

### Added

- Bounded application-level rate limits for Auth, recovery, session, ordinary API and expensive
  read routes, with account/session, source and process-wide ceilings.
- HMAC-only bucket identities, a hard bucket cap, lazy fixed-window expiry, stable `429` errors and
  standard limit/retry response metadata.
- Local production-bundle secret smoke and an exact-target hosted security smoke for `SEC_011`.

### Security

- `Cross-Origin-Resource-Policy`, DNS-prefetch denial, cross-domain-policy denial and an explicit
  `object-src 'none'` CSP directive.
- Health/readiness remain outside throttling so Render probes cannot make the service unhealthy.

### Status

- PR #7 deployed the GH-0204 implementation from merge commit
  `67b55cfb4268312a7ba146f40811af7b499866e5`.
- `HOSTED_SECURITY_SMOKE_PASS`, the public hosted smoke and the complete authenticated acceptance
  matrix pass against the exact Render origin; test-owned Auth/database rows and the Mailtrap
  recovery message were removed.
- GH-0204 is `DONE`; coordinated platform packages advance to `0.9.0` while the `REFERENCE_APP`
  product manifest remains `0.1.0`.

## [0.8.0] - 2026-08-22

### Added

- Global Dashboard route with a future-proof `ALL_WORKSPACES` / `SELECTED_WORKSPACES` portfolio
  scope and an honest no-metrics empty state.
- Accessible sidebar workspace switcher with keyboard navigation and a validated creation dialog.
- Explicit Settings navigation button with Profile and Organization kept as internal settings tabs.
- Project-name search with a magnifying-glass control, live result count and accent-insensitive matching.
- Real Settings pages for Profile and Organization, including persisted locale/timezone preferences
  and shared-organization display-name updates.
- Two-step signup onboarding for name, credentials, language, IANA timezone and the initial personal
  organization name, with editable browser-derived defaults.
- Frontend contract tests covering navigation, onboarding, workspace selection/creation semantics
  and removal of profile/infrastructure status from the normal Dashboard.

- Fail-closed `HOSTED_STAGING` runtime contract for exact HTTPS origin, Render port binding,
  Supabase project identity, verified database TLS, secure cookies and bounded pooling.
- Render Blueprint with GitHub-check-gated deploys, secret placeholders and a database-backed
  `/api/ready` health check.
- GitHub Actions clean-install gate for the complete embedded verification, release manifest and
  high-severity dependency audit.
- High-confidence repository secret scan and browser/server configuration boundary check.
- Public, read-only hosted smoke command and a deployment/rollback runbook.
- Unit coverage for hosted/local runtime rejection, migration readiness, Blueprint safety, HSTS,
  secure cookies and failure redaction.
- Fingerprint-pinned public Supabase Root 2021 CA plus Blueprint-managed `NODE_EXTRA_CA_CERTS` for
  fully verified PostgreSQL TLS from the hosted Node process.
- Cross-platform release-manifest hashing that canonicalizes text line endings while preserving
  binary bytes, preventing Windows/Linux CI drift.
- Guarded hosted acceptance runner for disposable HTTPS Auth, cookie, workspace, project, Audit,
  PKCE/Mailtrap recovery and exact cleanup evidence.
- Worktree-safe staging wrapper that resolves machine-protected credentials from the canonical
  Engine without copying secrets into feature worktrees.

### Security

- Supabase Site URL and the sole recovery redirect match the exact Render HTTPS origin.
- Supabase custom SMTP uses the dedicated Mailtrap sandbox; its credentials remain outside Render,
  GitHub, source files, browser bundles and logs.
- Recovery links cross only a one-shot loopback bridge and are never printed or persisted.
- Final hosted cleanup asserts zero test-owned users, profiles, projects, memberships,
  organizations and Audit events.

### Status

- The frontend navigation/onboarding slice was merged in PR #5 and deployed by Render from merge
  commit `8aa77b391c65166fb6d02836580f0a499369d528`.
- Full translation remains dependent on GH-0701 because `@green-hive/i18n` is still scaffold-only;
  personal-workspace rename remains a separate reviewed authorization extension.
- The Free Render service is live and passes liveness, readiness, HSTS, no-store and shell smoke.
- GH-0201 and GH-0202 are `DONE` after the deployed HTTPS/cookie and Mailtrap PKCE recovery matrix.
- GH-0204 is `PARTIAL — HOSTED_BASELINE_PASS`; bounded deployed rate limiting remains.
- Coordinated platform packages advance to `0.8.0`; the `REFERENCE_APP` product manifest remains
  `0.1.0`.

### Not included

- Billing, AI, Redis, Jobs, external webhooks, remote storage, distributed rate limiting, MFA,
  production SMTP or consumer-domain functionality.

## [0.7.0] - 2026-08-20

### Added

- GH-0203 Audit Foundation through immutable migration `0011`.
- Append-only `audit.events` with actor, tenant/app/project scope, outcome, request/correlation IDs
  and bounded operational metadata.
- Transactional capture for organization creation, member changes, app installation and project
  create/archive/logical-delete lifecycle events.
- Typed `@green-hive/audit` event catalog, contracts, validation, stable errors, service and
  PostgreSQL repository.
- Protected `GET /api/audit` endpoint and Reference App activity panel scoped by the server-validated
  workspace cookie/session.
- Audit-specific unit, embedded PostgreSQL, native Supabase, Project Service and HTTP/cookie
  acceptance assertions.

### Security

- Authenticated clients receive only `SELECT` on `audit.events`; direct insert, update and delete
  remain unavailable and have no RLS policy.
- Cross-user, cross-app and cross-organization audit reads are denied.
- Captured metadata excludes project names, arbitrary domain metadata, prompts, documents, raw
  payloads, credentials, tokens and cookies.
- Platform administrators see only the same safe operational event shape and cannot reuse the
  tenant Audit Service or access private profiles/projects/settings.
- Idempotent provisioning, archive and logical-delete retries do not emit duplicate lifecycle
  events.

### Changed

- Authenticated database transactions now create one request/correlation UUID for downstream
  accountability events.
- Coordinated platform packages advance to `0.7.0`; the `REFERENCE_APP` product manifest remains
  `0.1.0`.
- Hosted staging advances to 11 immutable migrations with zero pending migrations and zero
  disposable test artifacts.

### Status

- GH-0203 is `DONE` after embedded, local Supabase and dedicated hosted staging parity gates.
- GH-0201 and GH-0202 remain partial only for exact hosted HTTPS/cookie and test-SMTP recovery
  evidence.

### Not included

- Observability aggregation, retention/purge automation, external webhooks, Billing, AI, Redis,
  Jobs, remote storage, feature flags or break-glass content access.

## [0.6.0] - 2026-08-20

### Added

- Canonical `IDEAS_RADAR.md` with promotion gates for 21 explicitly deferred platform and product
  ideas.
- GH-0250 Organizations & Multi-Tenancy Foundation through immutable migrations `0007`–`0010`.
- Personal and shared organizations, workspace memberships, organization app installations and
  optional app-scoped roles.
- Typed `WorkspaceService` and PostgreSQL repository in `@green-hive/projects`.
- Transaction-local trusted organization selection validated against active database membership.
- Reference App workspace selector, shared-workspace creation and HttpOnly preference cookie.
- Cross-organization RLS, service and HTTP matrices on embedded PostgreSQL, Supabase local and the
  dedicated hosted staging project.
- Dedicated `green-hive-staging` Supabase project in `sa-east-1`, kept separate from the existing
  Green Hive project.
- Guarded Windows operations for database preflight, baseline application, hosted RLS/Project
  Service tests and hosted Auth tests.
- Hosted baseline with migrations `0001` through `0006`, the structural `REFERENCE_APP` seed,
  immutable-ledger validation and non-destructive smoke checks.
- Eight-scenario hosted Auth/account matrix covering confirmed signup, profile/project isolation,
  trusted claims, refresh, logout and stable errors.
- Six unit scenarios proving rejection of local, cross-project, non-TLS, transaction-pooler and
  callback-mismatch staging configurations.
- User-bound DPAPI credential handling and official Supabase CA verification outside the
  repository and release artifacts.

### Changed

- Projects and settings now carry an immutable `organization_id` protected by composite membership,
  installation and parent-project foreign keys.
- `PLATFORM_ADMIN` retains operational app/organization metadata reads but no longer receives RLS
  access to private profiles, projects or project settings.
- Coordinated platform packages advance to `0.6.0`; the `REFERENCE_APP` product manifest remains
  `0.1.0`.
- Supabase Auth API-key headers now support both legacy JWT keys used by local development and the
  new publishable/secret key format used by hosted staging.
- Database SSL enforcement is enabled on staging; all Green Hive connections use
  `sslmode=verify-full`.

### Status

- GH-0250 and GH-0251 through GH-0259 are `DONE` after local and hosted parity gates.
- GH-0201 advances to `PARTIAL — STAGING_AUTH_CORE_PASS`.
- GH-0202 advances to `PARTIAL — STAGING_SERVICE_PASS`.
- Exact HTTPS hosting, hosted cookie-boundary validation and password recovery through dedicated
  test SMTP remain required before either checkpoint is promoted to `DONE`.

### Not included

- Billing behavior, chargeback, portfolio forecasting, AI Insights, break-glass access, Redis,
  Jobs, webhooks, remote storage or external app migration automation.

## [0.5.0] - 2026-08-19

### Added

- Canonical React `19.2.8` and Vite `8.2.1` browser shell for the Reference App.
- Fastify `5.12.1` HTTP adapter for Auth, profile and Project Service operations.
- Responsive landing, signup, login, password recovery, profile and project screens.
- One-command local preview that verifies Supabase, reapplies migrations/seed, builds and serves on
  `127.0.0.1:3000`.
- Four HTTP boundary unit scenarios and a seven-scenario native Supabase web matrix.
- Dedicated browser/HTTP checkpoint and operation documentation.

### Security

- Access and refresh tokens are held in HttpOnly, same-site, host-only cookies and are never
  returned to React or browser-accessible storage.
- Password recovery now uses PKCE: the callback exposes only a single-use authorization code, not
  access or refresh tokens.
- Mutating endpoints require the exact application origin and JSON content type; bodies are capped
  at 32 KiB.
- Authenticated responses are private/no-store and include CSP, clickjacking, MIME-sniffing,
  referrer, permissions and cross-origin opener protections.
- Browser payload allowlists reject app, owner, admin and unknown scope fields before services run.
- Local preview refuses non-loopback application, Auth or database endpoints.

### Status

- GH-0201 advances to `PARTIAL — LOCAL_WEB_PASS`.
- GH-0202 advances to `PARTIAL — LOCAL_HTTP_PASS`.
- GH-0204 is recorded as `PARTIAL — LOCAL_HTTP_BASELINE_PASS` for the safeguards already applied;
  deployed HTTPS, rate limiting and secret operations remain pending.
- Authorized Supabase staging remains the only unexecuted GH-0201/GH-0202 release gate.

### Not included

- Remote Supabase, staging deployment, production SMTP, social login, MFA, Billing, AI, Redis,
  jobs, webhooks, storage or consumer-domain functionality.

## [0.4.0] - 2026-08-18

### Added

- GH-0201 contracts and runtime validation in `@green-hive/auth` for signup, login, session
  refresh, local/global logout, password recovery completion and BeeGreen account profiles.
- Server-only `SupabaseServerAuthProvider` pinned to `@supabase/supabase-js@2.112.3`.
- Verified token-to-`TrustedAppContext` conversion that accepts authorization claims only from
  signed `app_metadata`.
- Transaction-scoped authenticated PostgreSQL runner and owner-only profile repository/service.
- Thin Reference App server facade composing Auth, profiles, Project Service and native RLS.
- Ten-scenario native Supabase Auth matrix and nine new Auth/account unit scenarios.
- Local Mailpit recovery validation, including following the recovery link and changing the
  password.

### Security

- Service-role credentials remain encapsulated in the server adapter and never enter public types
  or Reference App input.
- Each public Auth operation uses an isolated non-persistent Supabase Auth client.
- Recovery redirects are exact allowlist matches; client-supplied app/admin fields are rejected.
- Local Auth and Mailpit containers bind explicitly to `127.0.0.1`; PostgreSQL keeps its required
  Windows inbound firewall block.
- Test users, projects and captured emails are removed after the guarded local gate.

### Status

- GH-0201 is `PARTIAL` with local implementation and native Auth integration approved.
- Remote staging, framework-specific HTTP/browser integration and a production email provider were
  not authorized and remain pending.
- GH-0202 remains `PARTIAL`; its SQL and verified local session-to-service path pass, while HTTP and
  staging cross-user validation remain.

### Not included

- Remote Supabase, production SMTP, social login, MFA rollout, Billing, AI, Redis, jobs, webhooks,
  storage or domain functionality.

## [0.3.0] - 2026-08-18

### Added

- GH-0104 `@green-hive/projects` contracts: `Project`, `ProjectStatus`, `CreateProjectInput`,
  `ProjectRepository`, `ProjectService` and stable `ProjectError` codes.
- Server-side `PostgresProjectRepository` with explicit JWT/context agreement checks in addition
  to RLS.
- Runtime validation for trusted context, project IDs, names and bounded JSON metadata.
- Unit tests with a fake repository and an eight-scenario native Supabase integration matrix.

### Behavior

- `create` derives app and owner exclusively from verified context and creates `DRAFT` projects.
- `list`/`get` remain scoped to owner and app and hide deleted or foreign resources.
- `archive` and `softDelete` are idempotent; archived/deleted timestamps are not duplicated.
- Owner commands reject platform administrators; administrative reads remain a separate SQL/RLS
  boundary until the future Admin service exists.
- Storage exceptions become safe stable errors without SQL text, provider details or nested causes.

### Not included

- HTTP endpoints, signup/login flows, Audit events, Billing, AI, Redis, jobs, webhooks or remote
  services.

## [0.2.1] - 2026-08-18

### Added

- Versioned Supabase CLI `2.115.0` and local-only PostgreSQL operation scripts.
- Guarded `db:test:supabase` parity gate with exact target and destructive confirmations.
- Native Supabase tests for ledger drift, seed identity, foreign keys and the complete RLS matrix.
- Windows local-network and firewall validation for PostgreSQL port 54322.

### Changed

- Promoted GH-0102 and GH-0103 from `PARTIAL` to `DONE` after native Supabase parity passed.
- Left the local database in a clean six-migration and `REFERENCE_APP`-seeded baseline.
- Kept GH-0202 `PARTIAL`; authentication, API and staging integration remain deferred.

### Not included

- Project Service, Auth flows, Billing, AI, Redis, jobs, webhooks and remote services.

## [0.2.0] - 2026-08-18

### Added

- GH-0102 database foundation with `hive`, `audit` and `reference_app` schemas.
- Six immutable migrations, metadata headers and a checksum-enforced database ledger.
- Supabase-linked app registry, user profiles, projects and project settings.
- Structural `REFERENCE_APP` seed and separate disposable RLS fixtures.
- Trusted `auth.uid()`/`auth.jwt()` helpers and owner/admin RLS policies.
- Logical deletion through `hive.soft_delete_project(uuid)` with no physical client deletion.
- Embedded and optional external Supabase/PostgreSQL isolation suites.
- `db:validate`, `db:migrate`, `db:seed`, `db:test` and `db:test:external` commands.

### Changed

- Restored `@green-hive/core` as the single App Manifest authority.
- Reconciled the monorepo to the 18 canonical platform packages and two canonical apps.
- Standardized package-local TypeScript outputs and coordinated platform version `0.2.0`.
- Added `DRAFT`, `ACTIVE`, `ARCHIVED` and `DELETED` project lifecycle states.

### Security

- App authority now comes only from signed `app_metadata.app_code`.
- User ownership comes only from `auth.uid()`.
- `auth.users` is the foreign-key authority for profiles and project owners.
- Platform administrators receive cross-app reads but no mutation policies.
- `user_metadata` and payload-provided identifiers cannot elevate access.

### Not included

- Billing, AI, Redis, queues, external webhooks, remote storage and consumer-domain features.
