# GH-0801 release validation — 2026-09-07

## Scope

This record closes GH-0801 Minimal Operational Admin at platform version `0.31.0`. The Reference
App product manifest remains `0.1.0`.

## Evidence

- CI for the feature, readiness correction and hosted-security contract correction passed before
  merge.
- Migration `0027` was applied to the dedicated Supabase staging project. Its migration ledger is
  now at 27 applied immutable migrations with zero pending entries.
- The dedicated staging RLS/Audit matrix passed, including platform-admin aggregate-only access,
  denial of non-admin authority and denial of commercial writes/provider-reference reads.
- The deployed Render service passed public HTTPS readiness/header and guarded rate-limit security
  smoke checks.
- `PUBLIC_HTTPS_ACCEPTANCE_PASS` passed against
  `https://green-hive-staging.onrender.com`. It covered protected cookies, refresh/profile,
  projects/workspaces/Audit, verified fake-payment entitlement, cross-user/workspace denial,
  forged scope/CSRF denial, logical deletion, idempotent webhook handling, Mailtrap password
  recovery, old-password rejection, new-session login and logout.
- The post-run staging preflight confirmed `ACTIVE_HEALTHY`, 27 applied migrations, zero pending
  migrations and zero disposable users, profiles, projects, settings or apps.

## Boundary retained

The operational overview stays aggregate-only and read-only. It does not introduce tenant-content
browsing, user impersonation, payment reconciliation, provider-reference disclosure, administrative
writes or `BYPASSRLS`.
