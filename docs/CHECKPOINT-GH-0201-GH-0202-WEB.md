# Checkpoint GH-0201/GH-0202 - local web boundary

## Result

Status: `PARTIAL - STAGING_AUTH_CORE_PASS / STAGING_SERVICE_PASS; HTTPS_SMTP_PENDING`.

The local framework/HTTP/session gates and the hosted server-side Auth-to-Project-Service path now
pass. Neither checkpoint is promoted to `DONE` because the deployed HTTPS/cookie boundary and
hosted password-recovery email path have not yet been exercised.

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
- six canonical migrations and the structural seed applied without a remote reset;
- 10 RLS/database, 8 Project Service and 8 Auth/account scenarios passed;
- trusted `app_metadata` remains the only app/admin claim source;
- all disposable hosted users, profiles, projects and settings removed after the run.

## Remaining gate

1. choose and configure an exact HTTPS host for the Reference App;
2. configure exact Supabase Site URL/recovery redirects and a dedicated test SMTP sender;
3. repeat signup, login, recovery, logout, profile and owned-project scenarios through HTTPS;
4. repeat cross-user, cross-app, forged-scope and cookie/session tests;
5. restrict database network access after the hosting egress topology is known;
6. promote GH-0201/GH-0202 only after all evidence passes.
