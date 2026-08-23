# Checkpoint GH-0201/GH-0202 - web and hosted boundary

## Result

Status: `DONE - HOSTED_HTTPS_SMTP_ACCEPTANCE_PASS`.

The local framework/HTTP/session gates, hosted server-side Auth-to-Project-Service path and the
deployed HTTPS/cookie boundary all pass. Password recovery was exercised through Supabase custom
SMTP and the dedicated Mailtrap sandbox, so GH-0201 and GH-0202 are promoted to `DONE`.

The repository now also passes a local hosted-runtime gate: exact HTTPS configuration,
`0.0.0.0:$PORT` binding, secure cookies, HSTS, database-backed readiness, Render Blueprint,
GitHub CI and secret scanning. No Render service or remote secret was created by this work.

## Delivered in platform 0.5.0

- React `19.2.8` and Vite `8.2.1` Reference App shell;
- Fastify `5.12.1` server boundary bound to loopback for local preview;
- signup, login, refresh, logout, PKCE recovery, profile and project routes;
- HttpOnly, same-site, host-only session cookies;
- exact-origin mutation guard, JSON-only bodies and 32 KiB body limit;
- security and private no-store response headers;
- browser payload allowlists with no app, owner or admin scope fields;
- native Supabase HTTP integration matrix with two isolated users;
- visually validated `/` and `/auth/recovery` screens;
- one-command local preview workflow.

## Preserved

- migrations `0001` through `0006` remain byte-for-byte unchanged;
- the structural `REFERENCE_APP` seed and UUID remain unchanged;
- the `REFERENCE_APP` product manifest remains version `0.1.0`;
- GH-0102, GH-0103 and GH-0104 remain `DONE`;
- the pre-existing Green Hive Supabase project remains untouched;
- guarded, non-destructive staging database/Auth commands are operational;
- Billing, AI, Redis, jobs, webhooks, storage and domain features remain out of scope.

## Hosted staging evidence

- dedicated Free-plan project `green-hive-staging` in `sa-east-1`;
- database SSL enforcement and official-CA verification enabled;
- eleven canonical migrations and the structural seed applied without a remote reset;
- 10 RLS/database, 8 Project Service and 8 Auth/account scenarios passed;
- trusted `app_metadata` remains the only app/admin claim source;
- all disposable hosted users, profiles, projects and settings removed after the run.

## Hosting preparation evidence

- `HOSTED_STAGING` rejects non-production, loopback, cross-project, callback-mismatch, non-TLS and
  reserved-port configurations before the server listens;
- `/api/ready` validates eleven ledger entries, the fixed `REFERENCE_APP` seed, projects, Audit
  and trusted app/organization helpers;
- readiness failures return `503` without database internals;
- the Blueprint contains five `sync: false` secret/config placeholders and no migration/seed
  command;
- GitHub CI is read-only and uses a clean locked install before complete verification;
- hosted smoke testing is public and read-only;
- 54 unit/contract scenarios pass before the complete embedded database gate.

## Hosted completion evidence

1. Render deploy for merge commit `8aa77b391c65166fb6d02836580f0a499369d528` is live;
2. public smoke passes liveness, database readiness, HSTS, no-store and the React shell;
3. Supabase Site URL and the sole recovery redirect match the exact Render HTTPS origin;
4. Supabase custom SMTP points to the dedicated Mailtrap sandbox, not Render;
5. deployed signup, protected cookies, refresh, logout, profile, workspaces, projects and Audit pass;
6. cross-user, cross-workspace, forged-scope and CSRF attempts are rejected with stable errors;
7. logical deletion remains owner-scoped and its bounded Audit lifecycle is retained;
8. Mailtrap PKCE recovery changes the password, rejects the old password and rejects code reuse;
9. cleanup proves zero disposable users, profiles, projects, memberships, organizations and events.

Database egress hardening and deployed rate limiting remain GH-0204/production operations, not
acceptance blockers for GH-0201 or GH-0202.
