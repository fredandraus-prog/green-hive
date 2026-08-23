# Dedicated Supabase staging gate

Status: `DATABASE_RLS_PROJECT_AUTH_BILLING_PASS - RENDER_HEALTHY_HTTPS`.

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

Database SSL enforcement is enabled. The Render service exists, but a healthy deployment and its
egress topology have not yet been confirmed. Network access therefore still accepts the standard
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
protected for the current Windows user in the Engine `.secrets` directory beside the canonical
repository.

The operation wrapper decrypts credentials only in process memory, clears the environment
afterward and does not print connection strings or keys. The public Supabase Root 2021 CA is
committed at `config/supabase-root-2021-ca.crt`, fingerprint-pinned by tests and shared by the
guarded Windows staging wrapper and the hosted Node process through `NODE_EXTRA_CA_CERTS`. The
server uses the new publishable/secret key format; local Supabase remains compatible with legacy
JWT-shaped anon/service-role keys.

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
3. applies all canonical pending migrations, currently `0001` through `0014`, using the ledger;
4. reapplies the migrator to prove no duplication;
5. applies the structural `REFERENCE_APP` and sandbox Billing catalog seeds twice;
6. verifies ledger, seed identities, native FKs, RLS, helpers and grants.

`staging:database:test` executes the hosted RLS/database matrix, the 10-scenario Project/Workspace
Service matrix and the 7-scenario native Billing Service/provider matrix. `staging:auth:test` creates two
uniquely named confirmed test accounts, executes the server-side Auth/account matrix, and deletes
their projects, Billing rows, settings, profiles and Auth users in a final cleanup block.

These commands never run `supabase db reset --linked`, never drop a remote schema and never clear
unrelated Auth users. The only canonical migrations remain under `database/migrations`;
`supabase/migrations` is disabled.

## Passed hosted evidence

- project identity and health: confirmed;
- migrations/ledger: fourteen applied, zero pending, reapplication creates no duplicate;
- seeds: deterministic `REFERENCE_APP` and sandbox catalog, reapplied twice;
- database/RLS: 13 passed, 0 failed;
- Project/Workspace Service: 10 passed, 0 failed;
- Billing Service/provider: 7 passed, 0 failed;
- Auth/account core: 8 passed, 0 failed;
- confirmed signup and isolated owner profiles: passed;
- profile and owned-project access: passed;
- `user_metadata` privilege forgery: denied;
- only controlled `app_metadata.app_code` changes the active app: passed;
- refresh rotation, logout revocation and stable public errors: passed;
- final database state: fourteen ledger rows, one structural app, one sandbox product/price and
  zero disposable fixture rows;
- final Auth cleanup: zero `staging-owner-*@example.test` users.

## Hosted acceptance completion

Database, RLS, Project/Workspace Service, Audit, Auth and the deployed HTTPS cookie boundary pass.
Supabase Site URL and the sole `/auth/recovery` redirect match the Render origin, custom SMTP uses
the dedicated Mailtrap sandbox, and the guarded runner passes signup/login/recovery/logout/profile,
project, cross-user, cross-workspace, forged-scope, CSRF and logical-deletion scenarios. Cleanup
asserts zero test-owned Auth and tenant/Audit rows. GH-0201 and GH-0202 are `DONE`.

Database egress hardening after a stable hosting topology and deployed rate limiting remain
GH-0204/production operations.
