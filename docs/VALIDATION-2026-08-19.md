# Validation evidence - 2026-08-19

## Environment

- Windows 11 / PowerShell
- Node.js `v24.14.0`
- npm `11.9.0`
- WSL `2.7.12.0`, kernel `6.18.33.2`
- Docker Desktop `4.87.0`, Linux engine `29.7.2`
- Supabase CLI `2.115.0`, PostgreSQL `17.6`
- React `19.2.8`, Vite `8.2.1`, Fastify `5.12.1`

## Platform 0.5.0 local gates

- clean source installation with `npm ci`: passed;
- formatting, platform lint and canonical 18-package boundary lint: passed;
- TypeScript typecheck and 20-workspace coordinated build: passed;
- production React/Vite bundle: passed;
- App Manifest, Auth/account, database, local-target, Project Service, HTTP and staging-guard
  unit/contract tests: 38 passed, 0 failed;
- six-migration static validation: passed;
- embedded PostgreSQL migrations, seed and RLS matrix: 9 passed, 0 failed;
- native local Supabase database/RLS matrix: 10 passed, 0 failed;
- native local Supabase Project Service matrix: 8 passed, 0 failed;
- native local Supabase Auth/account/PKCE matrix: 10 passed, 0 failed;
- native local Supabase Reference App HTTP/cookie matrix: 7 passed, 0 failed;
- total local static/unit/embedded/native scenario checks: 82 passed, 0 failed;
- migrations `0001` through `0006`: unchanged;
- original `MANIFEST.csv`: unchanged;
- local Auth and Mailpit: healthy and bound to `127.0.0.1`;
- PostgreSQL: protected by the required Windows inbound firewall block;
- cleanup baseline: six ledger rows, one `REFERENCE_APP`, zero disposable users/projects and zero
  Mailpit messages.

## Hosted Supabase staging

The dedicated project `green-hive-staging` (`rabkyesatfuezmrrzllx`) is active and healthy in
`sa-east-1`. It belongs to the BeeGreen organization on the Free plan and is distinct from the
pre-existing project named `Green Hive`, which was not modified.

Security and connection evidence:

- database SSL enforcement: enabled;
- connection: IPv4 session pooler, port 5432, database `postgres`;
- TLS verification: `sslmode=verify-full` with the official Supabase Root 2021 CA;
- credentials: Windows-user-bound DPAPI files outside the repository and all ZIPs;
- hosted Auth: new publishable/secret API-key format, never printed by operation scripts;
- canonical migrations: only `database/migrations`; no `supabase/migrations` copy;
- destructive remote reset or schema drop: absent from staging operations.

Hosted acceptance evidence:

- preflight identity, native Auth contract and baseline state: passed;
- migrations `0001` through `0006`: applied once, checksums verified, zero pending;
- migration reapplication: no duplicates;
- `REFERENCE_APP` seed applied twice: deterministic identity retained;
- hosted database/RLS matrix: 10 passed, 0 failed;
- hosted Project Service matrix: 8 passed, 0 failed;
- hosted Auth/account core matrix: 8 passed, 0 failed;
- confirmed signup, login, refresh and logout: passed;
- profile and owned-project isolation: passed;
- cross-user and cross-app access: denied;
- forged `user_metadata` administration/app scope: denied;
- controlled `app_metadata.app_code` selection: passed;
- stable public errors without provider/SQL leakage: passed;
- post-test database state: six ledger rows, one structural app, zero disposable fixture rows;
- post-test Auth state: zero `staging-owner-*@example.test` users.

## Browser and HTTP evidence

The local Reference App started through `npm run reference-app:start` at
`http://127.0.0.1:3000`. The root and `/auth/recovery` routes rendered correctly without console
warnings or errors.

The unit and native local HTTP suites proved:

1. access and refresh tokens are written only to HttpOnly, same-site cookies;
2. tokens, service credentials and PKCE state do not appear in JSON responses;
3. cross-origin mutations and non-JSON bodies are rejected before service execution;
4. browser payloads cannot select app, owner or platform role;
5. two users in the same app remain isolated through HTTP, services and RLS;
6. profile, project creation, archive and logical deletion work through the cookie session;
7. password recovery uses PKCE and callback URLs contain no access or refresh token;
8. logout clears browser cookies and revokes the refresh session.

## Preservation and manifest

- pre-work source-only backup:
  `backups/green-hive-v0.5.0-pre-staging-20260819-003300.zip`;
- pre-work backup SHA-256:
  `FD5A994C8BA3EC47F7B794FEC2536FB8A8C999164B46CB9FF12378AC48CE4749`;
- prepared pre-remote snapshot:
  `backups/green-hive-staging-prepared-validated-v0.5.0-20260819-004544.zip`;
- prepared snapshot SHA-256:
  `6D7D0AB145C9A6A63B7FDC2E8660DD38F80D7B97818CF6D919C588F2C6DDB4CD`;
- both backups exclude installed dependencies, build outputs, caches, `.env`, logs and secrets;
- final `MANIFEST-SHA256.txt` generation and extracted-copy verification are part of the packaging
  gate after this evidence file is finalized.

## Status conclusion

- GH-0102, GH-0103 and GH-0104 remain `DONE`.
- GH-0201 is `PARTIAL — STAGING_AUTH_CORE_PASS`.
- GH-0202 is `PARTIAL — STAGING_SERVICE_PASS`.
- GH-0204 remains `PARTIAL — LOCAL_HTTP_BASELINE_PASS`.

The remaining GH-0201/GH-0202 acceptance gate is now limited to the deployed HTTPS/cookie boundary
and password recovery through dedicated test SMTP. No hosting or SMTP provider was created, and no
remote application was exposed during this validation.
