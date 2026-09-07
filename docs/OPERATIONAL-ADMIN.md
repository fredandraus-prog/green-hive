# GH-0801 — Operational administration

The operational dashboard is deliberately read-only. It is available only after the server verifies a session whose JWT `app_metadata.platform_role` is exactly `PLATFORM_ADMIN`.

`GET /api/admin/overview` accepts no user, app, workspace, project or role scope from a path, query string, request body, header or browser storage. The server derives authority from the protected session cookie on every request. The browser may use the verified `isPlatformAdmin` account field solely to show the navigation link; the route repeats authorization independently.

## Returned data

`hive.operational_admin_overview()` is a security-definer function with a fixed search path. It validates `auth.uid()` and `hive.is_platform_admin()` and returns one bounded JSON aggregate: user/workspace totals; projects, purchases, payments, jobs and budgets grouped by status; costs grouped by currency; and AI/Search operations grouped by provider code.

It returns no profiles, project names/metadata, payment provider references, payment identifiers, prompts, search input/results, job input/output, files, secrets or arbitrary tenant rows. `authenticated` receives EXECUTE only on this narrow aggregate function; no new table `SELECT`, `INSERT`, `UPDATE`, `DELETE` or `BYPASSRLS` privilege is granted.

## Validation boundary

The native Supabase matrix proves an administrator can obtain aggregate state from another tenant while a direct payment provider-reference read and a commercial update are denied. A non-admin JWT is denied by both the service and SQL function before any overview is returned.
