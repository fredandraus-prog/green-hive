# Checkpoint GH-0201 - Auth and account integration

## Result

Status: `DONE - HOSTED_HTTPS_SMTP_ACCEPTANCE_PASS`.

The local implementation, dedicated Supabase staging project and deployed React/Fastify boundary
all pass. Signup, login, refresh, logout, profile, protected HttpOnly cookies and PKCE password
recovery were exercised through the exact Render HTTPS origin. Supabase delivered the recovery
message through the dedicated Mailtrap custom SMTP configuration, and all disposable identities
and tenant rows were removed after the run.

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

## Hosted acceptance delivered in platform 0.8.0

- CI-gated deployed Render service and database-backed readiness;
- exact HTTPS origin, HSTS, no-store and protected host-only cookies;
- Mailtrap recovery acceptance through Supabase custom SMTP;
- one-time PKCE code with no tokens in the callback URL or response body;
- signup, refresh, logout, profile, project, workspace and Audit acceptance;
- cross-user, cross-workspace, forged-scope and CSRF rejection;
- exact cleanup of test Auth users and all related tenant/Audit rows.

## Still not delivered

- production SMTP;
- social providers;
- administrative MFA;
- account export/deletion workflow;
- GH-0204 deployed rate limiting.

## Next gate

GH-0201 has no remaining gate. Continue with the bounded deployed rate-limit work required to
complete GH-0204; production SMTP, social login and MFA require separate authorization.
