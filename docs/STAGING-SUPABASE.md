# Dedicated Supabase staging gate

Status: `DATABASE_RLS_PROJECT_AUTH_CORE_PASS - HOSTING_PREPARED - HTTPS_SMTP_PENDING`.

The Green Hive staging environment is an isolated hosted Supabase project. It is used only to
validate canonical migrations, RLS, Project Service and Auth/account behavior before a public
application deployment. It is not production and it is not a second migration source.

## Confirmed environment

```text
organization: BeeGreen
project:      green-hive-staging
project ref:  rabkyesatfuezmrrzllx
region:       sa-east-1 (São Paulo)
plan:         Free
database:     postgres through the IPv4 session pooler on port 5432
TLS:          sslmode=verify-full with the official Supabase Root 2021 CA
```

The pre-existing project named `Green Hive` is separate and was not modified. At validation time,
the organization had no payment method or invoice and Spend Cap was enabled. Plan and billing
state can change outside this repository and must be rechecked before any future paid resource is
created.

Database SSL enforcement is enabled. Render is the prepared HTTPS host, but no service exists and
its egress topology has not been confirmed. Network access therefore still accepts the standard
Supabase public CIDRs; restrict that boundary only after the real hosting source addresses or
supported pooler architecture are known.

Official references:

- <https://supabase.com/docs/guides/deployment/managing-environments>
- <https://supabase.com/docs/guides/platform/regions>
- <https://supabase.com/docs/guides/platform/ssl-enforcement>
- <https://supabase.com/docs/guides/database/connecting-to-postgres>
- <https://supabase.com/docs/guides/getting-started/api-keys>

## Secret boundary

No password or API key is stored in the repository, manifest or ZIP. Machine-local values are
protected for the current Windows user under:

in the `.secrets` sibling directory at the GreenHive workspace root.

The operation wrapper decrypts them only in process memory, clears the environment afterward and
does not print connection strings or keys. The official CA certificate is stored in the same
excluded directory. The server uses the new publishable/secret key format; local Supabase remains
compatible with legacy JWT-shaped anon/service-role keys.

## Guarded commands

Run from the canonical repository:

```text
npm run staging:database:preflight
npm run staging:database:apply
npm run staging:database:test
npm run staging:auth:test
```

`staging:database:preflight` verifies the linked project reference, project name, region, health,
session-pooler TLS endpoint, native Auth functions and the exact managed-schema state. It also
fails if a known disposable fixture remains.

`staging:database:apply`:

1. repeats the database-only preflight;
2. runs `db:validate`;
3. applies all canonical pending migrations, currently `0001` through `0011`, using the ledger;
4. reapplies the migrator to prove no duplication;
5. applies the structural `REFERENCE_APP` seed twice;
6. verifies ledger, seed identity, native FKs, RLS, helpers and grants.

`staging:database:test` executes the hosted 10-scenario RLS/database matrix and the 10-scenario
Project/Workspace Service matrix. `staging:auth:test` creates two uniquely named confirmed test accounts,
executes the server-side Auth/account matrix, and deletes their projects, settings, profiles and
Auth users in a final cleanup block.

These commands never run `supabase db reset --linked`, never drop a remote schema and never clear
unrelated Auth users. The only canonical migrations remain under `database/migrations`;
`supabase/migrations` is disabled.

## Passed hosted evidence

- project identity and health: confirmed;
- migrations/ledger: eleven applied, zero pending, reapplication creates no duplicate;
- seed: deterministic `REFERENCE_APP`, reapplied twice;
- database/RLS: 10 passed, 0 failed;
- Project/Workspace Service: 10 passed, 0 failed;
- Auth/account core: 8 passed, 0 failed;
- confirmed signup and isolated owner profiles: passed;
- profile and owned-project access: passed;
- `user_metadata` privilege forgery: denied;
- only controlled `app_metadata.app_code` changes the active app: passed;
- refresh rotation, logout revocation and stable public errors: passed;
- final database state: eleven ledger rows, one structural app, zero disposable fixture rows;
- final Auth cleanup: zero `staging-owner-*@example.test` users.

## Remaining acceptance gate

Database, RLS, Project Service and server-side Auth core are no longer pending. GH-0201/GH-0202
still require:

1. creation and validation of the prepared exact HTTPS Render host for the React/Fastify app;
2. matching Supabase Site URL and `/auth/recovery` redirect configuration;
3. a dedicated test SMTP sender and mailbox retrieval path;
4. server-only injection of the database and secret values into that host;
5. the signup/login/recovery/logout/profile/project flow through real HTTPS cookies;
6. cross-user, cross-app, forged-scope, CSRF and logical-deletion checks through the deployed API;
7. post-test cleanup and database network restriction once hosting egress is known.

No checkpoint is promoted to `DONE` until this narrower HTTPS/Auth/SMTP evidence passes.
