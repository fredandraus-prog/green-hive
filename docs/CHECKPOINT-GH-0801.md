# GH-0801 — Minimal operational admin

## Delivered

- `@green-hive/hive-admin` provides a typed, read-only operational overview.
- The Reference App exposes the protected `/api/admin/overview` route and a navigation entry visible only after backend-recognized platform authority.
- Immutable migration `0027` creates `hive.operational_admin_overview()`. The function returns aggregate-only data and retains all table-level RLS and provider-reference column boundaries.
- Unit, HTTP and native Supabase coverage prove role denial, forged browser scope rejection, aggregate visibility, no provider-reference exposure and no commercial write authority.

## Deliberate boundary

This is not break-glass support access, tenant-content browsing, administrative mutation, payment reconciliation, user impersonation or an observability system. The only output is a bounded aggregate operational snapshot.

## Release gate

The local clean gate and local native Supabase matrix must pass before staging. The checkpoint moves to `DONE` only after migration `0027`, the dedicated staging matrix, CI and the deployed HTTPS smoke pass. Until then it remains `PARTIAL — LOCAL IMPLEMENTATION PASS`.
