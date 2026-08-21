# Checkpoint GH-0201/GH-0202 - web and hosted boundary

## Result

Status: `PARTIAL - HOSTING_PREPARATION_PASS; HTTPS_SMTP_ACCEPTANCE_PENDING`.

The local framework/HTTP/session gates and the hosted server-side Auth-to-Project-Service path now
pass. Neither checkpoint is promoted to `DONE` because the deployed HTTPS/cookie boundary and
hosted password-recovery email path have not yet been exercised.

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

## Remaining gate

1. merge the prepared branch after GitHub CI passes and create the reviewed Render Blueprint;
2. configure exact Supabase Site URL/recovery redirects and a dedicated test SMTP sender;
3. repeat signup, login, recovery, logout, profile and owned-project scenarios through HTTPS;
4. repeat cross-user, cross-app, forged-scope and cookie/session tests;
5. restrict database network access after the hosting egress topology is known;
6. promote GH-0201/GH-0202 only after all evidence passes.
