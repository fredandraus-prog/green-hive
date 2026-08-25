# Implementation status

Status date: 2026-08-24.

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
| GH-0403+ | NOT_STARTED | Jobs and later checkpoints remain outside this release | implement Jobs foundation next |

The local Supabase parity gate passed on PostgreSQL 17.6 with native `auth.users`, `auth.uid()` and
`auth.jwt()`. The dedicated hosted staging project also passes the eighteen-migration baseline,
RLS, Project/Workspace/Billing Services and server-side Auth/account matrices. Hosted test users
and rows are removed after each run, leaving eighteen ledger records and the structural
`REFERENCE_APP`, sandbox catalog and entitlement-mapping seeds.

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
