# Dedicated Supabase staging gate

Status: `DATABASE_RLS_PROJECT_AUTH_BILLING_ENTITLEMENTS_COST_GUARD_AI_SEARCH_GATEWAY_PASS - REAL_AI_PENDING`.

The Green Hive staging environment is an isolated hosted Supabase project. It is used only to
validate canonical migrations, RLS, Project Service, Auth/account, Billing, verified webhooks,
Entitlements, Usage/Cost, Atomic Cost Guard, AI Gateway and deterministic Search Gateway behavior
before a public application deployment. It is not production and it is not a second migration
source.

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

Database SSL enforcement is enabled and the Render service is healthy. The Free service does not
provide a stable egress identity suitable for a narrow database allowlist, so network access still
uses the standard Supabase public endpoint with verified TLS. Restrict that boundary only after a
stable hosting source address or supported private/pooler architecture is available.

Official references:

- <https://supabase.com/docs/guides/deployment/managing-environments>
- <https://supabase.com/docs/guides/platform/regions>
- <https://supabase.com/docs/guides/platform/ssl-enforcement>
- <https://supabase.com/docs/guides/database/connecting-to-postgres>
- <https://supabase.com/docs/guides/getting-started/api-keys>
- <https://developers.openai.com/api/docs/models/gpt-4o-mini>
- <https://developers.openai.com/api/docs/guides/structured-outputs>

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

GH-0504 does not add a provider key to Render or the repository. Its optional paid gate expects a
separate user-bound DPAPI blob at
`Engine/.secrets/green-hive-staging-openai-api-key.dpapi`. The value is loaded only for that command
and removed from the process environment in `finally`.

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
3. applies all canonical pending migrations, currently `0001` through `0022`, using the ledger;
4. reapplies the migrator to prove no duplication;
5. applies the structural `REFERENCE_APP`, sandbox Billing catalog, reviewed Entitlements mappings
   and Reference App job registration seeds twice;
6. verifies ledger, seed identities, native FKs, RLS, helpers and grants.

`staging:database:test` executes the hosted RLS/database matrix, the 10-scenario Project/Workspace
Service matrix, the 7-scenario native Billing Service/provider matrix, verified-webhook concurrency,
the 6-scenario Entitlements matrix, the 5-scenario Usage/Cost matrix, the 5-scenario Atomic Cost
Guard matrix and the Jobs/Worker/Notification plus deterministic AI/Search Gateway lifecycle matrices,
including separate-connection concurrent reservation and exclusive job claim.
`staging:auth:test` creates two
uniquely named confirmed
test accounts, executes the server-side Auth/account matrix, and deletes their projects,
Usage/Cost, Entitlements, Billing rows, settings, profiles and Auth users in a final cleanup block.

These commands never run `supabase db reset --linked`, never drop a remote schema and never clear
unrelated Auth users. The only canonical migrations remain under `database/migrations`;
`supabase/migrations` is disabled.

## Controlled real AI command

`npm run ai:real:test:staging` is a separate paid gate and is never called by `verify`, CI,
`staging:database:test` or Render. Do not run it until all of the following have been reviewed:

1. a dedicated OpenAI project/API key exists only for this staging proof;
2. provider-side spending and rate controls are set as low as the provider permits;
3. the current official price for the exact `gpt-4o-mini-2024-07-18` snapshot still matches the
   registered USD 0.15 input / USD 0.60 output per million tokens;
4. the DPAPI blob exists at the exact machine-local path above;
5. no prior `green-hive-gh0504-real-provider-attempt-v0.21.0.json` marker exists.

The runner verifies the dedicated Supabase target and the complete migration ledger, prepares only
disposable fixtures, reserves at most USD `0.0002`, executes the registered `INTERNAL` structured
task with `maxAttempts: 1`, verifies operation/usage/cost/Audit evidence and cleans the fixtures in
`finally`. Immediately before the provider boundary it creates the marker atomically. The marker
contains no secret or prompt and is deliberately retained after success or failure, so a second
attempt requires explicit investigation and authorization rather than an automatic rerun.

## Passed hosted evidence

- project identity and health: confirmed;
- migrations/ledger: twenty-two applied, zero pending, reapplication creates no duplicate;
- seeds: deterministic `REFERENCE_APP`, sandbox catalog, two reviewed capability mappings and
  Reference App job registration, reapplied twice;
- database/RLS: 13 passed, 0 failed;
- Project/Workspace Service: 10 passed, 0 failed;
- Billing Service/provider: 7 passed, 0 failed;
- verified webhook concurrency/replay: 1 passed, 0 failed;
- Entitlements grant/revoke/cross-scope matrix: 6 passed, 0 failed;
- Usage/Cost exact-decimal/idempotency/RLS matrix: 5 passed, 0 failed;
- Atomic Cost Guard entitlement/reserve/consume/release/concurrency matrix: 5 passed, 0 failed;
- Jobs registration/enqueue/read/isolation matrix: passed;
- Worker claim/lease/heartbeat/retry/terminal/recovery matrix: passed;
- deterministic AI Gateway accounting/isolation matrix: passed;
- deterministic Search Gateway accounting/isolation matrix: 1 passed, 0 failed;
- controlled real OpenAI staging task: pending dedicated key and spending control;
- Auth/account core: 8 passed, 0 failed;
- confirmed signup and isolated owner profiles: passed;
- profile and owned-project access: passed;
- `user_metadata` privilege forgery: denied;
- only controlled `app_metadata.app_code` changes the active app: passed;
- refresh rotation, logout revocation and stable public errors: passed;
- final database state: twenty-two ledger rows, one structural app, one sandbox product/price, two
  reviewed capability mappings, one registered Reference App job type and zero disposable fixture
  rows;
- final Auth cleanup: zero `staging-owner-*@example.test` users.

## Hosted acceptance completion

Database, RLS, Project/Workspace Service, Audit, Auth, Billing, verified webhooks, Entitlements,
Usage/Cost, Atomic Cost Guard and the deployed HTTPS cookie boundary pass.
Supabase Site URL and the sole `/auth/recovery` redirect match the Render origin, custom SMTP uses
the dedicated Mailtrap sandbox, and the guarded runner passes signup/login/recovery/logout/profile,
project, cross-user, cross-workspace, forged-scope, CSRF, logical deletion and payment-derived
capability-decision scenarios. Cleanup asserts zero test-owned Auth, tenant, Billing, Entitlements,
Usage/Cost, Cost Guard and Audit rows. GH-0201, GH-0202, GH-0304, GH-0401 and GH-0402 are `DONE`.

Database egress hardening after a stable hosting topology and deployed rate limiting remain
GH-0204/production operations.
