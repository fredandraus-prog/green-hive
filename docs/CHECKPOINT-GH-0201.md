# Checkpoint GH-0201 - Auth and account integration

## Result

Status: `PARTIAL - LOCAL_WEB_PASS; STAGING_NOT_AUTHORIZED`.

The local implementation now passes native Supabase Auth plus the React/Fastify browser and cookie
boundary. The checkpoint is not marked `DONE` because the canonical specification requires the
full account and owned-project path to pass in staging.

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

## Not delivered

- remote Supabase staging;
- production SMTP;
- social providers;
- administrative MFA;
- account export/deletion workflow;
- GH-0203 Audit or GH-0204 deployed security baseline.

## Next gate

1. create or link a Supabase staging project only after explicit authorization;
2. configure exact HTTPS staging callback URLs and test SMTP;
3. run signup/login/logout/recovery/owned-project and cross-user tests in staging;
4. promote GH-0201 to `DONE` only after that evidence passes;
5. finish GH-0202's staging authorization evidence.
