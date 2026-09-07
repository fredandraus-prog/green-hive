# Implementation status

Status date: 2026-09-07.

Current coordinated platform version: `0.27.0`. The `REFERENCE_APP` product manifest remains
`0.1.0`.

| Checkpoint | Status | Validation | Remaining gate |
|---|---|---|---|
| GH-0001 | DONE | canonical naming, 18 packages and boundary lint | none |
| GH-0002 | DONE | canonical manifest, registry and tests | none |
| GH-0101 | DONE | lockfile, clean `npm ci`, typecheck and package-local build | none |
| GH-0102 | DONE | original six immutable migrations, native FKs, ledger and seed pass on Supabase local | none |
| GH-0103 | DONE | embedded and native Supabase owner/app isolation matrices pass | none |
| GH-0104 | DONE | typed Project Service, runtime validation, unit and native Supabase integration tests | none |
| GH-0201 | DONE | signup, login, refresh, logout, protected cookies and PKCE recovery through Supabase custom SMTP/Mailtrap pass on the deployed HTTPS service | none |
| GH-0202 | DONE | cross-user, cross-workspace, forged-scope, CSRF, logical-delete and Audit isolation pass through the deployed HTTPS API/cookies | none |
| GH-0203 | DONE | append-only tenant audit store, transactional lifecycle capture, safe metadata, local/staging RLS and service/HTTP tests | none |
| GH-0204 | DONE | local and deployed account/source/global limits, stable `429`, hardened headers, bundle scan, public smoke and authenticated acceptance pass | none; distributed limits are a future scale-out gate |
| GH-0250 | DONE | Organizations foundation, personal/shared workspaces and tenant-aware Project Service pass locally and on dedicated staging | none |
| GH-0251–GH-0255 | DONE | organizations, workspace memberships, personal provisioning, app installations and app roles validated | none |
| GH-0256–GH-0258 | DONE | trusted organization selection, tenant RLS, cross-organization matrix and shared workspace service validated | none |
| GH-0259 | DONE | stable organization/app-installation ownership identities created without implementing Billing | none |
| GH-0301 | DONE | app catalog, exact-decimal price versions, tenant purchase/payment snapshots, transactional pending creation, Audit and embedded/native Supabase service/RLS gates | none |
| GH-0302 | DONE | deterministic network-free provider, server-only success/failure/full-refund transitions, safe Audit and embedded/local/staging Supabase gates | none |
| GH-0303 | DONE | exact-body HMAC verification, replay rejection, provider-event uniqueness, concurrent duplicate single effect, reconciliation and embedded/local/staging gates | none |
| GH-0304 | DONE | manifest-reviewed product mappings, payment-derived grant/revocation snapshots, server-authoritative `can()`, Audit and embedded/local/staging/HTTPS gates | none |
| GH-0401 | DONE | exact-decimal project budgets, separate append-only usage/cost ledgers, idempotent server writers, limited owner reads, admin inspection and embedded/local/staging/HTTPS gates | none |
| GH-0402 | DONE | entitlement-first decisions, exact-decimal atomic reserve/consume/release, concurrent no-overspend, RLS, Audit and embedded/local/staging Supabase gates | none |
| GH-0403 | DONE | registered queue schema, protected idempotent enqueue, entitlement gate, RLS/Audit and unit/embedded/local/staging Supabase gates pass | none |
| GH-0404 | DONE | migration `0020`, typed Worker service, unit/embedded/local/staging Supabase matrices, CI, Render readiness and published HTTPS acceptance pass | none |
| GH-0501 | DONE | provider-neutral text/structured contracts, strict runtime validation, deterministic network-free fake provider, clean gate, CI, Render readiness and public HTTPS smoke pass | none |
| GH-0502 | DONE | canonical data classifications, exact Trust matrix, fail-closed gaps, controlled confirmation, strict tests, clean gate, CI, Render readiness and public HTTPS smoke pass | none |
| GH-0503 | DONE | server-owned task/model/schema registry, Trust/Cost Guard enforcement, exact accounting, runtime schema validation, local/staging native Supabase matrices, CI, Render readiness and public HTTPS/security smokes pass | none |
| GH-0504 | PARTIAL | fixed OpenAI Responses adapter, exact snapshot, strict schema, conservative cost reservation and one-shot staging runner pass deterministic local gates | dedicated key, provider-side spending control and one controlled real staging call |
| GH-0505 | DONE | provider-neutral Search Gateway, deterministic zero-network fake, atomic accounting, metadata-only migration `0022`, local/staging Supabase, CI and deployed HTTPS/security gates pass | none |
| GH-0601 | DONE | private generated-file service, migration `0023`, owner-only RLS, fake/private-provider adapters and embedded/native local Supabase matrices pass | real bucket activation and delivery remain separate operational/future gates |
| GH-0602 | DONE | immutable migration `0024`, private local/staging Storage bucket, real disposable private-write/public-denial/signed-read/cleanup gates, server-owned short signed grants, owner/app/workspace recheck, safe `FILE_EXPORTED` audit and unit/embedded/native database matrices pass | none |
| GH-0603 | DONE | deterministic TEXT/PDF renderer, lease-bound private file lifecycle, Reference App one-job processor and unit/embedded/dedicated native Supabase staging matrices pass | none; no template execution, public storage, daemon or paid renderer was added |
| GH-0604 | DONE | immutable job-completion notification record, owner/app/workspace RLS, typed service, protected API and Reference App in-app view pass unit, embedded PostgreSQL-compatible, dedicated native Supabase and deployed HTTPS/security gates | none; no external delivery provider, polling or push path |
| GH-0701 | DONE | typed locale/message/formatting core, safe `pt-BR`/`en-US` fallback, persisted profile adoption and Reference App core language switch pass unit and clean verification | none; no translation provider, remote locale configuration or authorization behavior |

The local Supabase parity gate passed on PostgreSQL 17.6 with native `auth.users`, `auth.uid()` and
`auth.jwt()`. The dedicated hosted staging project passes the twenty-two-migration baseline, RLS,
Project/Workspace/Billing Services, AI/Search Gateways and server-side Auth/account matrices.
Hosted test users and rows are removed after each run, leaving 22 ledger records, zero pending
migrations, zero disposable fixtures and only the reviewed structural seeds.

The GH-0505 clean gate passes: `npm ci` installs 149 packages with zero audit vulnerabilities;
`npm run verify` passes 160 unit tests and 21 embedded database scenarios; and `db:validate`
confirms 22 immutable migrations and 25 RLS-protected tables. Native local and dedicated-staging
Supabase gates pass the Search matrix (`1/1`). The authenticated staging matrix passes `8/8`, and
the exact deployed HTTPS application passes public and security smokes.

GH-0403 adds registered job types and one tenant-safe PostgreSQL queue. Enqueue revalidates
trusted user/app/workspace/project scope and the required entitlement, stores hashes rather than
raw payloads/keys, emits one minimized `JOB_QUEUED` event and exposes only sanitized status.
GH-0404 adds exclusive leases, one-time raw claim tokens with stored hashes only, heartbeat,
bounded retry, completion, failure, cancellation and expired-lease recovery. Browser roles cannot
execute Worker functions or read lease/output internals. A continuously running worker process,
Redis and external brokers remain outside this slice.

GH-0501 introduces only the provider adapter boundary and deterministic fake implementation.
Applications supply an app-prefixed task identity, vendor-neutral model class, bounded task input
and operation identity. They cannot select a provider/model, send an API key or reuse this contract
as an authorization source. AI Gateway orchestration, Trust Policy, task/model registry, schema
validation, Cost Guard/Job integration and real provider execution remain future checkpoints.

GH-0502 adds a server-only classification and policy-decision boundary. Raw prompt/payload content
never enters evaluation. Canonical policy gaps deny, confidential operations name the required
sanitization action, and highly confidential data remains denied unless an exact controlled policy
requires confirmation for a specific provider with confidential mode. It does not authorize a
project, sanitize app semantics, collect confirmation or invoke an external provider.

GH-0503 composes the existing provider, Trust, Entitlements, Cost Guard and Usage/Cost boundaries.
Callers select only an app-registered task; provider/model/schema/capability/pricing/limits remain
server-owned. Migration `0021` retains only safe operation metadata and terminal Audit evidence.
The app-owned structured schema is validated after every provider result. No real provider, secret,
browser route, prompt catalog, Search integration or Redis is included.

GH-0504 adds a fixed OpenAI Responses adapter and an allowlisted Reference App staging profile. The
remote endpoint and `gpt-4o-mini-2024-07-18` snapshot, prices, schema, limits and retry policy are
server-owned. A conservative 1,024-token request allowance is added only to the Cost Guard estimate;
actual cost remains based on provider-reported use. The paid gate is manual, one-shot and absent
from CI/Render. It has not run because no dedicated API key has been installed, so the checkpoint
cannot yet be promoted to `DONE`.

GH-0505 adds a provider-neutral Search contract, deterministic `FakeSearchProvider` and server-only
Gateway composition. The fake needs no network, provider account, API key or external charge.
Registered server authority selects the provider and limits; Trust and Cost Guard decisions precede
execution; exact request/result accounting follows it. Migration `0022` uses literal app namespaces,
requires an exact operation/reservation estimate match and retains only safe operation metadata.
Accounted success and failure are atomic; only start, unreserved failure, accounted completion and
accounted failure are exposed to the service role, the direct success-transition helper stays
private, and owner/admin reads are limited by RLS.
Terminal Audit evidence and operation rows contain no query, URL, snippet or raw result. See
[Search Gateway](SEARCH.md), [GH-0505 checkpoint](CHECKPOINT-GH-0505.md) and
[GH-0505 implementation validation](VALIDATION-2026-09-02-GH0505-IMPLEMENTATION.md), followed by
[GH-0505 release validation](VALIDATION-2026-09-02-GH0505-RELEASE.md).

The Reference App has a responsive React/Vite shell and a Fastify HTTP adapter. Tokens remain
outside browser-accessible storage, PKCE recovery avoids URL tokens, and local plus deployed HTTP
tests repeat cross-user, cross-workspace and forged-scope scenarios through the real cookie boundary.
Every participating user receives one personal workspace and can create or select shared
workspaces. Material organization/project changes create correlated append-only Audit events with
bounded metadata. `PLATFORM_ADMIN` can read operational tenant/audit metadata but has no RLS path
to private profiles, projects or settings. Supabase Auth uses the exact Render origin and recovery
callback; its custom SMTP points to the dedicated Mailtrap sandbox and does not enter Render or the
repository.

GH-0301/GH-0302 provide provider-neutral commercial foundations and a deterministic sandbox
adapter. Owners can request an idempotent pending purchase; the trusted backend can then apply one
configured success/failure result and a full refund. Authenticated users cannot select that result,
execute the transition functions or read provider references. GH-0303 verifies exact webhook bytes,
deduplicates provider events under lock and provides authoritative provider reconciliation without
storing raw payloads or signatures. GH-0304 derives independent project capability snapshots only
from those authoritative transitions. Its server-side `can()` decision repeats
user/app/workspace/project scope and accepts no commercial or grant authority from browser input.
GH-0401 adds separate logical-usage and monetary-cost evidence plus limited owner-visible budgets.
All accounting writes remain server-only and idempotent. Monetary provider cost stays hidden from
project owners. GH-0402 adds entitlement-first, exact-decimal reserve/consume/release decisions;
budget-row locking prevents concurrent reservations from crossing the configured ceiling, and
consumption records the GH-0401 cost event atomically.

The private GitHub repository deploys `main` through the CI-gated Render Blueprint. The Free service
`green-hive-staging` is live at the exact HTTPS origin with database-backed readiness, public and
security smokes, and the disposable authenticated acceptance matrix. The GH-0304 deployment of
merge commit `99a1015` proved payment-derived capability decisions, cross-scope denial and verified
webhook single effect. GH-0401 merge commit `15c2da2` was then deployed automatically by Render as
`dep-da697o3l550s73cd75bg`; its seventeenth-migration staging gate left zero test artifacts, and the
public readiness plus hosted security smokes passed on the exact HTTPS origin. Migration `0018`
and the GH-0402 native staging matrix pass with eighteen ledger rows and zero test artifacts. The
first `0.15.0` Render attempt from feature merge `91e0fcf` correctly failed because application
readiness still required 17 migrations. Readiness hotfix PR #20 advanced the contract to 18 and
verifies the Cost Guard tables/functions; merge commit `325a7a4` deployed successfully as
`dep-da6djmbncjis738915rg`, and the public plus hosted-security smokes pass.
GH-0403 then established the nineteen-migration queue baseline. GH-0404 migration `0020`, the
complete native Worker matrix and final cleanup pass on dedicated staging. Feature merge
`fc65e29` deployed successfully as `dep-da7ls0h5efls738rmnpg`; twenty-migration readiness, public,
security and authenticated HTTPS acceptance all pass.
GH-0501 adds no migration or public AI route. Feature merge `4c3faf5` deployed successfully as
`dep-da7n4j7lk1mc73892bkg`; the unchanged twenty-migration readiness contract and the exact public
HTTPS liveness, security-header and Reference App shell smoke all pass.
GH-0502 also adds no migration or public Trust route. Feature merge `71292d4` deployed successfully
as `dep-da7pq8m417fc738gccdg`; the unchanged twenty-migration readiness contract and the exact public
HTTPS liveness, security-header and Reference App shell smoke all pass.
GH-0503 applies immutable migration `0021` and the full AI Gateway matrix on dedicated staging,
leaving twenty-one ledger rows and zero disposable artifacts. Feature merge `80f2b3d` deployed
successfully as `dep-da7vg695efls73908bcg`; the twenty-one-migration readiness contract, exact
public HTTPS smoke and hosted-security smoke all pass.
GH-0505 applies immutable migration `0022` and the deterministic Search Gateway matrix on dedicated
staging, leaving 22 ledger rows, zero pending migrations and zero disposable fixtures. PR #33 merged
as `37c7752`; feature, pull-request and merged-`main` CI pass, GitHub marks the merge deployed and
active in `main - green-hive-staging`, and the exact public HTTPS plus hosted-security smokes pass.
The Render dashboard session expired before the provider-specific deploy ID could be recorded, so
the documentation preserves the observed GitHub environment identity without inventing one.
