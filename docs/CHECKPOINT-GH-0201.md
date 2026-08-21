# Checkpoint GH-0201 - Auth and account integration

## Result

Status: `PARTIAL - HOSTING_PREPARATION_PASS; HTTPS_SMTP_ACCEPTANCE_PENDING`.

The local implementation passes native Supabase Auth plus the React/Fastify browser and cookie
boundary. The dedicated hosted Supabase project also passes the server-side Auth/account and
owned-project core. A fail-closed Render runtime and CI contract now pass locally, but the
checkpoint is not `DONE` until the complete path passes through deployed HTTPS cookies and
Mailtrap-backed password recovery.

## Delivered

- coordinated platform version `0.5.0`;
- `@green-hive/auth` public contracts, validation, services and stable errors;
- pinned `@supabase/supabase-js@2.112.3` server adapter;
- server-controlled app assignment through the canonical `AppRegistry`;
- verified Auth server identity before `TrustedAppContext` construction;
- owner profile bootstrap, read and update against native RLS;
- transaction-local `authenticated` database role and sanitized signed claims;
- Reference App server facade composing Account and Project services;
- signup, login, refresh, local/global logout and complete password recovery;
- loopback-only Auth and Mailpit services;
- unit and native local integration tests;
- cleanup of disposable users, projects, profiles and emails.
- responsive signup, login, recovery, profile and project screens;
- HttpOnly cookie session adapter and exact-origin HTTP boundary;
- PKCE recovery callback with no session tokens in the URL;
- native HTTP/cookie/RLS integration tests and visual browser validation.

## Preserved

- migrations `0001` through `0006` are byte-for-byte unchanged;
- the database ledger and structural `REFERENCE_APP` seed remain unchanged;
- the `REFERENCE_APP` manifest stays at product version `0.1.0`;
- GH-0102, GH-0103 and GH-0104 remain `DONE`;
- Billing, Entitlements, AI, Redis, jobs, webhooks and remote storage remain unimplemented.

## Acceptance evidence

The local suite proves:

1. server-controlled signup creates confirmed native `auth.users` records;
2. login returns a verified `REFERENCE_APP` session;
3. profiles are created and updated only by their owner;
4. owner A creates and lists its project through the Project Service and RLS;
5. owner B cannot read A's profile or project;
6. `user_metadata` cannot forge app scope or `PLATFORM_ADMIN`;
7. only controlled `app_metadata.app_code` changes active app authority;
8. client payload cannot select app, owner or administrative role;
9. refresh rotates the opaque token and logout revokes further refresh;
10. recovery email is captured locally, the allowlisted link is followed and the password changes;
11. wrong credentials and invalid sessions return stable errors;
12. all test-owned data is removed after the gate.

All earlier database, RLS and Project Service native gates were rerun successfully after the Auth
changes.

## Hosting preparation delivered after platform 0.7.0

- Render Node web-service Blueprint with CI-gated deploys and no automatic database mutation;
- exact HTTPS origin/callback and confirmed Supabase project validation;
- Render `0.0.0.0:$PORT` binding separated from the public security origin;
- secure cookies, HSTS and database-backed readiness;
- GitHub Actions clean-install verification and repository secret scan;
- read-only hosted smoke command and dashboard runbook.

## Not delivered

- deployed Render service and HTTPS/cookie acceptance evidence;
- Mailtrap recovery acceptance through Supabase custom SMTP;
- production SMTP;
- social providers;
- administrative MFA;
- account export/deletion workflow;
- GH-0203 Audit or GH-0204 deployed security baseline.

## Next gate

1. merge the prepared branch only after the complete local and GitHub CI gates pass;
2. create the reviewed Render Blueprint and register the five server-only values;
3. configure exact Supabase HTTPS callback URLs and Mailtrap test SMTP;
4. run signup/login/logout/recovery/owned-project and cross-user tests through Render;
5. promote GH-0201 to `DONE` only after that evidence passes.
