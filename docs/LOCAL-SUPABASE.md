# Local Supabase parity environment

Green Hive pins `supabase@2.115.0` as a development dependency. No global npm install, remote
Supabase project or paid service is required. The local runtime uses Docker Desktop with its WSL 2
Linux backend. The guarded stack starts PostgreSQL, Supabase Auth and Mailpit for GH-0102 through
GH-0201/GH-0202 integration tests and local Reference App preview. Realtime, Storage, PostgREST,
Studio, Edge Runtime, Analytics and the
remaining optional services stay disabled.

## Canonical ownership

`database/migrations` is the single migration source and `database/seeds` is the single structural
seed source. Supabase's own migration and seed runners are disabled in `supabase/config.toml` so a
second history cannot emerge.

## Commands

```text
npm ci
npm run supabase:start
npm run supabase:status
npm run db:test:supabase
npm run auth:test:supabase
npm run web:test:supabase
npm run verify:supabase
npm run reference-app:start
npm run supabase:stop
```

The external gate validates Docker/Supabase health, runs `db:validate`, migrates an empty managed
state, reapplies the migrator, seeds twice, runs the native RLS matrix and ledger-drift tests,
cleans only test-owned objects, restores migrations and the `REFERENCE_APP` seed, and runs the
GH-0104 Project/Workspace Service, GH-0203 Audit and GH-0302 sandbox Billing integration matrices.
The Billing matrix proves authenticated clients cannot apply provider results while the trusted
backend supports idempotent success, failure and full refund.

`auth:test:supabase` reads the local keys directly from the versioned CLI without printing them,
creates disposable real Auth users, exercises the Reference App server facade, captures a recovery
email in Mailpit, follows the recovery link, changes the password and removes all test-owned users,
projects, profiles and messages in cleanup.

`web:test:supabase` repeats account and project isolation through the real Fastify/cookie boundary.
`reference-app:start` prepares the same local baseline, builds React/Vite and serves the complete
application exclusively at `http://127.0.0.1:3000`.

## Destructive-operation guard

All conditions below must match before the local suite can drop anything:

- host `127.0.0.1` or `localhost`;
- port `54322`;
- database `postgres`;
- `GREEN_HIVE_TEST_TARGET=LOCAL_SUPABASE`;
- `GREEN_HIVE_TEST_CONFIRM=DROP_GREEN_HIVE_TEST_SCHEMAS`;
- native `auth.users`, `auth.uid()`, `auth.jwt()` and `authenticated` role.

Cleanup is hard-coded to schemas `hive`, `audit`, `reference_app` and the three fixture UUIDs. It
does not drop `auth`, `public`, `extensions` or any other Supabase-owned schema.

## Windows network boundary

The Docker network `green-hive-local` declares localhost as the default host binding. Docker
Desktop for Windows may still display the published database port as `0.0.0.0`; therefore the
local gate also requires an enabled inbound block named `Green Hive Local Supabase PostgreSQL` for
TCP port 54322. The Docker engine itself uses the `dockerDesktopLinuxEngine` named pipe and is not
exposed over TCP.

Docker Desktop ignored the network's default host binding for the Auth gateway and Mailpit ports.
The Green Hive start script therefore excludes the broad CLI-published gateway/mail container and
recreates only the required Auth and Mailpit containers with these exact bindings:

```text
127.0.0.1:54321 -> Supabase Auth
127.0.0.1:54324 -> Mailpit
```

`supabase:start` and `supabase:status` fail if either service is missing, unhealthy or bound to a
non-loopback address. Do not remove the PostgreSQL firewall rule while the local database is
running. The local stack has development credentials and no TLS; it must never be treated as a
production environment.
