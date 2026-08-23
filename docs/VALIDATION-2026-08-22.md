# Validation 2026-08-22 - hosted HTTPS/Auth/RLS acceptance and platform 0.8.0

## Scope

This record closes the dedicated staging acceptance gates for GH-0201 and GH-0202. It covers the
private GitHub repository, the existing Free Render service, the dedicated Supabase staging project
and the dedicated Mailtrap sandbox. It does not claim production readiness and does not implement
Billing, AI, Redis, Jobs, external webhooks, remote storage or distributed rate limiting.

## Preservation

- base commit: `8aa77b391c65166fb6d02836580f0a499369d528`;
- source-only backup: `Engine/backups/green-hive-pre-hosted-acceptance-v0.8.0-20260822.zip`;
- backup SHA-256: `63E398341E0722AB2D5E2BE83C569269BD5CEE5AC593CDDEF01F6885B178037B`;
- isolated branch: `feat/gh0201-gh0202-hosted-acceptance-v080`;
- unrelated worktrees and the user's existing staging account/workspace were not modified.

## Configuration evidence

- Supabase project: `green-hive-staging`, project ref `rabkyesatfuezmrrzllx`, region `sa-east-1`;
- project state: `ACTIVE_HEALTHY`;
- migration ledger: 11 applied, 0 pending;
- Site URL: exact `https://green-hive-staging.onrender.com`;
- sole recovery redirect: exact `/auth/recovery` path on that origin;
- custom SMTP: enabled in Supabase Auth with the dedicated Mailtrap sandbox;
- SMTP credentials remain in provider dashboards and were not written to the repository or Render;
- the locally protected database password was synchronized from the already healthy Render URL and
  remains encrypted for the current Windows user through DPAPI.

## Public smoke

`npm run hosted:smoke` passed:

- liveness;
- database-backed readiness;
- HSTS;
- private/no-store responses;
- Reference App shell.

## Authenticated hosted acceptance

`npm run hosted:acceptance` passed twice. The final version proves:

- confirmed server-controlled signup through the deployed API;
- HttpOnly, Secure, host-only, SameSite=Lax cookies;
- session refresh without returning provider tokens to React;
- owner profile update;
- personal and shared workspace selection;
- owner-scoped project creation, archive and logical deletion;
- append-only bounded Audit lifecycle;
- cross-user and cross-workspace denial;
- forged owner/app input denial;
- cross-origin mutation denial;
- stable public errors without SQL, stack or provider-secret leakage;
- PKCE recovery email delivered by Supabase through Mailtrap;
- exact allowlisted callback with no URL fragment or session tokens;
- password change, old-password rejection, new-password login and code-reuse rejection;
- logout and revoked browser session.

The recovery link crossed a one-shot loopback bridge into the guarded runner and was never printed
or stored in a source file. Mailtrap credential values and recovery tokens are absent from logs and
release artifacts.

## Cleanup

Every run used three uniquely named `hosted-acceptance-*` accounts. The final cleanup asserted zero:

- matching `auth.users`;
- user profiles;
- projects;
- organization memberships;
- personal/shared organizations;
- actor-owned Audit events.

The two disposable Mailtrap messages were deleted after validation. A final staging preflight
returned `BASELINE_READY`, 11 applied migrations, 0 pending migrations and no canonical fixture
artifacts. The pre-existing authenticated staging account and workspace remained available.

## Checkpoint result

- GH-0201: `DONE`;
- GH-0202: `DONE`;
- GH-0203: remains `DONE`;
- GH-0204: `PARTIAL - HOSTED_BASELINE_PASS`; deployed rate limiting remains;
- coordinated platform version: `0.8.0`;
- `REFERENCE_APP` product manifest: remains `0.1.0`.
