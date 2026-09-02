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
GH-0403/GH-0404 add registered queue isolation, exclusive claims, hashed lease tokens, heartbeat,
bounded retry and terminal Worker transitions. GH-0503 composes Trust Policy, Entitlements, Cost
Guard, provider usage, runtime schemas and metadata-only AI operation/Audit evidence while proving
cross-user/app denial and read-only browser/admin access.
GH-0505 adds provider-neutral Search contracts, deterministic fake results marked as untrusted
external data, runtime validation, Trust sanitization/denial, Cost Guard reservation and exact
Usage/Cost evidence. The estimate multiplies request unit cost by all configured attempts and result
unit cost by maximum results; successful actual accounting multiplies request unit cost by every
physical provider attempt, including retries, and result unit cost by returned results.
The embedded composition verifies atomic reservation consumption, usage recording and successful
Search completion through `hive.complete_search_operation_accounted(...)`, while the lower-level
completion helper remains private. It verifies that post-reservation failure atomically releases
the reservation and records the failed operation/Audit transition, while simple failure refuses an
operation with a reservation. Accounted success and failure reject estimate mismatches. Literal
app-prefix tests include app codes with underscores. The composition also verifies metadata-only
`search_operations`, hidden request fingerprints, server-only writers, duplicate-operation
protection and cross-user/workspace/app denial. `FakeSearchProvider` performs no network request and
causes no external provider charge.

`npm run db:test:supabase` is the supported local external gate. It requires host
`127.0.0.1|localhost`, port `54322`, database `postgres`,
`GREEN_HIVE_TEST_TARGET=LOCAL_SUPABASE`, the exact destructive confirmation and native Supabase
Auth objects. It only drops the `hive`, `audit` and `reference_app` schemas and removes the three
fixed test-user UUIDs it inserted. A separately provisioned database whose name contains `test`
remains supported by `db:test:external`.

The local gate applies all twenty-two immutable migrations and checks twenty-five RLS-protected
tables. `search:test:supabase` exercises the GH-0505 service and `hive.search_operations` against
native Supabase Auth/RLS using the same deterministic fake. It verifies owner/admin reads,
cross-tenant denial, private simple completion, server-only accounted completion/failure, atomic
economic rollback, safe Audit evidence and complete fixture cleanup without contacting a Search
provider.

`projects:test:supabase` exercises the compiled `@green-hive/projects` service against the same
native RLS boundary. It inserts only the existing fixed fixtures, removes them in `finally` and
leaves the twenty-two-migration plus structural seed baseline intact.

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

`jobs:test:supabase`, `workers:test:supabase` and `ai:test:supabase` verify the registered queue,
leased Worker lifecycle and the complete metadata-only AI Gateway composition on native Supabase.
GH-0504 adds `ai-real-provider.staging.integration.test.mjs` as a separate manual paid gate. It is
not included in `db:test`, `db:test:supabase`, `staging:database:test`, `verify` or CI. The gate uses
one deterministic operation, one provider attempt, an atomic machine-local attempt marker and
always removes its database/Auth fixtures.
The AI gate proves runtime schema validation, exact Usage/Cost evidence, minimized Audit, hidden
fingerprints, server-only lifecycle functions and owner/user/app/admin RLS boundaries.

`staging:database:test` includes the same fake-backed Search matrix against staging PostgreSQL.
This is an infrastructure/RLS parity check, not a real-provider test: it uses no Search API key,
makes no Search-provider network request and has no external Search cost.

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
