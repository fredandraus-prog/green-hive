# Hosted staging preparation

Status: `SERVICE_CREATED - BUILD_PASS - TLS_CA_FIX_PREPARED - HEALTHY_DEPLOY_PENDING`.

This runbook records and verifies the Green Hive Reference App's first exact HTTPS deployment. It
does not authorize production use and does not make Render a second database or migration
authority. Supabase remains the canonical staging database and Auth provider; Mailtrap remains
only the test SMTP destination.

## Preserved boundary

- canonical repository: the private GitHub repository `fredandraus-prog/green-hive`;
- application host: the Free Render Node web service `green-hive-staging`;
- database and Auth: the existing `green-hive-staging` Supabase project;
- SMTP: the existing `green-hive-staging` Mailtrap sandbox, with hosted recovery evidence pending;
- migrations: controlled commands under `database/migrations`, never application startup;
- secrets: provider dashboards and user-bound local protection only, never GitHub, logs, ZIPs or
  browser code.

The committed `render.yaml` contains secret variable names with `sync: false`, not their values.
It deliberately has no `preDeployCommand`, `db:migrate` or `db:seed` action.

## Runtime contract

`HOSTED_STAGING` fails before listening unless all of these conditions hold:

1. `NODE_ENV=production`;
2. `GREEN_HIVE_APP_ORIGIN` is an exact, non-loopback HTTPS origin;
3. `PORT` is a valid non-reserved port injected by Render;
4. the server binds to `0.0.0.0` while the public allowlist remains the exact HTTPS origin;
5. the recovery redirect is exactly `<origin>/auth/recovery`;
6. Auth and database endpoints belong to the confirmed Supabase staging project;
7. the database uses the direct or IPv4 session pooler on port `5432` with
   `sslmode=verify-full` and the fingerprint-pinned Supabase Root 2021 CA;
8. provider keys and the database connection exist only in the server process;
9. cookies are `HttpOnly`, host-only, `SameSite=Lax` and `Secure`;
10. the database ledger has exactly migrations `0001` through `0011`, the structural
    `REFERENCE_APP` seed exists and the critical tenant/audit helpers are present.

`GET /api/health` is a process liveness check. `GET /api/ready` is the Render health check and
returns `503` without internal details when the database contract is unavailable.

## Blueprint contract

The Blueprint defines:

```text
service:     green-hive-staging
type:        Node web service
plan:        free
region:      Virginia
branch:      main
deploy:      only after GitHub checks pass
build:       npm ci --include=dev && npm run build
start:       npm run start:hosted
health:      /api/ready
database CA: ./config/supabase-root-2021-ca.crt through NODE_EXTRA_CA_CERTS
```

The existing staging service is in Virginia, the explicit east-US choice made before its creation.
Changing region would require replacing the service and remains outside this correction.

## Secret values in Render

The existing Blueprint service has the following five manually supplied values. They remain
managed only in Render and must be reviewed against these rules without exposing their contents:

| Variable | Source | Rule |
|---|---|---|
| `GREEN_HIVE_APP_ORIGIN` | final Render service URL | exact HTTPS origin, no trailing path |
| `GREEN_HIVE_AUTH_RECOVERY_REDIRECT` | final Render service URL | exact `<origin>/auth/recovery` |
| `DATABASE_URL` | Supabase connection settings | staging session pooler, port 5432, `sslmode=verify-full` |
| `GREEN_HIVE_SUPABASE_PUBLISHABLE_KEY` | Supabase API settings | server environment only in this app |
| `GREEN_HIVE_SUPABASE_SERVICE_ROLE_KEY` | Supabase API settings | server-only secret; never browser-visible |

Do not paste those values into issues, commits, screenshots, chat messages or deployment logs.
The SMTP credentials do not belong in Render because Supabase Auth sends recovery email.

`NODE_EXTRA_CA_CERTS` is not a secret and is set by the Blueprint to the committed public trust
anchor at `config/supabase-root-2021-ca.crt`. The certificate fingerprint is pinned by unit tests.
Do not replace this with `NODE_TLS_REJECT_UNAUTHORIZED=0`, `rejectUnauthorized: false` or a weaker
database SSL mode.

The final service origin is `https://green-hive-staging.onrender.com`; both origin variables must
remain exact for that hostname before accepting the first healthy deploy.

The Free instance can sleep while idle and is suitable only for this staging gate, not production.

## Supabase and Mailtrap configuration after the URL exists

In the `green-hive-staging` Supabase Auth settings:

1. set Site URL to the exact Render HTTPS origin;
2. add only the exact `/auth/recovery` redirect required for staging;
3. configure custom SMTP with the Mailtrap `green-hive-staging` sandbox host, port, username and
   password;
4. use a clearly non-production sender identity;
5. do not enable broad wildcard redirects;
6. do not copy SMTP credentials into Render unless an application-owned mail feature is designed
   in a later checkpoint.

## First deployment gate

Before merging any hosting change:

```text
npm ci
npm run verify
npm run release:verify-manifest
npm audit --audit-level=high
```

After Render reports a healthy deploy, set the public origin only in the current terminal and run:

```powershell
$env:GREEN_HIVE_HOSTED_APP_ORIGIN = "https://your-service.onrender.com"
npm run hosted:smoke
Remove-Item Env:GREEN_HIVE_HOSTED_APP_ORIGIN
```

The smoke command sends only unauthenticated GET requests to the public application. It checks
liveness, database readiness, HSTS, no-store behavior and the React shell. It does not modify the
database.

The first remote build from commit `6307a0a` passed after build dependencies were explicitly
installed. Startup then reached the Supabase session pooler but failed with
`SELF_SIGNED_CERT_IN_CHAIN`, proving that the URL contract was correct while the Node trust store
did not yet contain the Supabase Root 2021 CA. This source correction supplies that trust anchor;
a new healthy Render deploy remains a required acceptance gate.

The final acceptance matrix must then exercise signup, login, refresh, logout, profile,
workspaces, projects, audit, PKCE recovery through Mailtrap, cross-user/cross-app/cross-workspace
denial, forged scope, CSRF, logical deletion and cleanup. GH-0201 and GH-0202 remain `PARTIAL`
until that hosted evidence passes.

## Rollback

If the first deploy fails, do not change the database to make the process start. Inspect the
Render startup error category without copying secret values, correct the Blueprint or environment
entry and redeploy. The application has not applied migrations or seed. The safe rollback is to
stop/delete only the newly created Render service; the GitHub release and Supabase baseline remain
unchanged.

## Official references

- <https://render.com/docs/web-services>
- <https://render.com/docs/blueprint-spec>
- <https://render.com/docs/health-checks>
- <https://render.com/docs/configure-environment-variables>
- <https://render.com/docs/node-version>
- <https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs>
- <https://supabase.com/docs/guides/auth/redirect-urls>
- <https://supabase.com/docs/guides/auth/auth-smtp>
- <https://docs.mailtrap.io/email-sandbox/setup/sandbox-smtp-integration>
