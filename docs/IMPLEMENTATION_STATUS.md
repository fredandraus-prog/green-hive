# Implementation status

Status date: 2026-08-21.

| Checkpoint | Status | Validation | Remaining gate |
|---|---|---|---|
| GH-0001 | DONE | canonical naming, 18 packages and boundary lint | none |
| GH-0002 | DONE | canonical manifest, registry and tests | none |
| GH-0101 | DONE | lockfile, clean `npm ci`, typecheck and package-local build | none |
| GH-0102 | DONE | original six immutable migrations, native FKs, ledger and seed pass on Supabase local | none |
| GH-0103 | DONE | embedded and native Supabase owner/app isolation matrices pass | none |
| GH-0104 | DONE | typed Project Service, runtime validation, unit and native Supabase integration tests | none |
| GH-0201 | PARTIAL — HOSTING_PREPARATION_PASS | local browser/recovery, hosted Auth core and fail-closed Render runtime/CI gates pass | deploy exact HTTPS cookie flow and password recovery through test SMTP |
| GH-0202 | PARTIAL — HOSTING_PREPARATION_PASS | hosted RLS/Services plus protected Render boundary configuration and readiness tests pass | repeat isolation through the deployed HTTPS API/cookies |
| GH-0203 | DONE | append-only tenant audit store, transactional lifecycle capture, safe metadata, local/staging RLS and service/HTTP tests | none |
| GH-0204 | PARTIAL — HOSTING_PREPARATION_PASS | local headers, exact-origin/body/secret guards, HSTS configuration, CI and repository secret scan pass | validate HTTPS and secret operations, then add deployed rate limits |
| GH-0250 | DONE | Organizations foundation, personal/shared workspaces and tenant-aware Project Service pass locally and on dedicated staging | none |
| GH-0251–GH-0255 | DONE | organizations, workspace memberships, personal provisioning, app installations and app roles validated | none |
| GH-0256–GH-0258 | DONE | trusted organization selection, tenant RLS, cross-organization matrix and shared workspace service validated | none |
| GH-0259 | DONE | stable organization/app-installation ownership identities created without implementing Billing | none |
| GH-0301+ | NOT_STARTED | outside this release | commercial core after GH-2 |

The local Supabase parity gate passed on PostgreSQL 17.6 with native `auth.users`, `auth.uid()` and
`auth.jwt()`. The dedicated hosted staging project also passes the eleven-migration baseline, RLS,
Project/Workspace Service and server-side Auth/account matrices. Hosted test users and rows are
removed after each run, leaving eleven ledger records and the structural `REFERENCE_APP` seed.

The Reference App has a responsive React/Vite shell and a Fastify HTTP adapter. Tokens remain
outside browser-accessible storage, PKCE recovery avoids URL tokens, and native local HTTP tests
repeat cross-user, cross-workspace and forged-scope scenarios through the real cookie boundary.
Every participating user receives one personal workspace and can create or select shared
workspaces. Material organization/project changes create correlated append-only Audit events with
bounded metadata. `PLATFORM_ADMIN` can read operational tenant/audit metadata but has no RLS path
to private profiles, projects or settings. The remaining Auth gate
is intentionally narrower: host that same boundary on an exact HTTPS origin, configure the
matching recovery callback and test SMTP, then repeat the HTTP/cookie and recovery paths there.

The repository now contains a Render Blueprint, strict hosted runtime validation, database-backed
readiness, a read-only hosted smoke command and GitHub CI. These are locally validated preparation,
not deployment evidence: no Render service was created and no secret or SMTP value was registered.
