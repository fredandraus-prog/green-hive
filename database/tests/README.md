# Database tests

`npm run db:test` runs a PostgreSQL-compatible database in process, installs the `pgcrypto`
extension, creates minimal `auth.users`, `auth.uid()` and `auth.jwt()` shims, applies the real Hive
migrations and executes policies as the non-superuser `authenticated` role.

The matrix covers owner access, cross-user denial, cross-app denial, forged owner/app identifiers,
untrusted `user_metadata`, read-only administration, logical deletion, retained settings,
reapplicable seed behavior, conflicting seed identity, paid capability grants, refund revocation,
independent-purchase retention and server-authoritative `can()` decisions.
It also covers GH-0401 exact-decimal budgets, separate logical usage and monetary cost events,
idempotent/conflicting replay, debit/credit aggregation, server-only writes and cross-scope denial.
GH-0402 adds entitlement denial, exact-decimal reserve/consume/release, duplicate replay,
conflicting operation identity, bounded actual cost, same-transaction cost evidence, cross-scope
denial and concurrent no-overspend assertions.

`npm run db:test:supabase` is the supported local external gate. It requires host
`127.0.0.1|localhost`, port `54322`, database `postgres`,
`GREEN_HIVE_TEST_TARGET=LOCAL_SUPABASE`, the exact destructive confirmation and native Supabase
Auth objects. It only drops the `hive`, `audit` and `reference_app` schemas and removes the three
fixed test-user UUIDs it inserted. A separately provisioned database whose name contains `test`
remains supported by `db:test:external`.

`projects:test:supabase` exercises the compiled `@green-hive/projects` service against the same
native RLS boundary. It inserts only the existing fixed fixtures, removes them in `finally` and
leaves the eighteen-migration plus structural seed baseline intact.

`entitlements:test:supabase` exercises the compiled `@green-hive/entitlements` service against
native RLS. It proves no grant while pending, two manifest-derived grants after payment, independent
revocation across two purchases, cross-user/workspace/app denial, read-only admin inspection and
cleanup ordering.

`usage-cost:test:supabase` exercises the compiled `@green-hive/cost-guard` GH-0401 foundation. It
proves exact-decimal persistence, idempotent budget/event replay, conflicting-key rejection,
logical debit/credit aggregation, server-only writers, owner-hidden raw cost, read-only admin
inspection, cross-user/workspace/app isolation and complete fixture cleanup.

`cost-guard:test:supabase` exercises GH-0402 using separate PostgreSQL connections for the
concurrency gate. It proves that simultaneous estimates cannot reserve beyond one budget, verifies
entitlement-first denial, idempotent replay, consume/release terminal behavior, same-transaction
cost evidence, read-only authenticated/admin access and complete fixture cleanup.

`auth:test:supabase` exercises real Supabase Auth against the loopback-only Auth service. It covers
signup, login, profile bootstrap/update, Project Service access, cross-user denial, signed app
claims, rejection of `user_metadata` elevation, refresh rotation, logout, password-recovery email
capture and password replacement. It uses unique disposable email addresses, deletes the exact
users/projects it created and clears Mailpit after the run.

`web:test:supabase` executes the compiled Fastify boundary against native local Auth and RLS. Two
disposable users prove HttpOnly session cookies, profile update, server-derived owner/app scope,
forged payload rejection, same-app cross-user denial, exact-origin enforcement, archive, logical
deletion and logout. It removes only the exact users and projects created by the run.

`verify:supabase` runs the database/RLS, Project Service, Auth/account and HTTP/cookie gates in that
order.
