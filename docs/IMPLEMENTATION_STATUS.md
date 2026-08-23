# Implementation status

Status date: 2026-08-23.

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
| GH-0303+ | NOT_STARTED | verified webhooks, reconciliation and Entitlements remain outside this release | implement signed, idempotent webhook processing next |

The local Supabase parity gate passed on PostgreSQL 17.6 with native `auth.users`, `auth.uid()` and
`auth.jwt()`. The dedicated hosted staging project also passes the fourteen-migration baseline,
RLS, Project/Workspace/Billing Services and server-side Auth/account matrices. Hosted test users
and rows are removed after each run, leaving fourteen ledger records and the structural
`REFERENCE_APP` plus sandbox catalog seeds.

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
execute the transition functions or read provider references. Billing still grants no Entitlement.

The private GitHub repository now deploys `main` through the CI-gated Render Blueprint. The Free
service `green-hive-staging` is live at the exact HTTPS origin, database-backed readiness and the
public smoke pass, and the full disposable hosted acceptance matrix cleans its users, tenant rows
and Mailtrap messages. GH-0204 is `DONE` after the exact hosted security smoke proved the deployed
limits and unthrottled health probes on merge commit `67b55cf`.
