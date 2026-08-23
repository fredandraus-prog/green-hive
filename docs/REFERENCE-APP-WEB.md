# Reference App web and HTTP boundary

## Purpose

Platform version `0.8.0` retains the tenant-aware workspace and Audit boundaries, publishes the
product-facing navigation slice and closes the deployed HTTPS/Auth/RLS acceptance gate. The
implementation follows the canonical React + Vite direction and keeps privileged decisions in a
Fastify server process.

This is a platform validation shell, not the first commercial BeeGreen product. It contains no
Billing, AI, Redis, jobs, webhooks, remote storage or consumer-domain behavior.

## Runtime topology

```text
Browser at exact local HTTP or hosted HTTPS origin
        |
        | same-origin JSON + HttpOnly cookies
        v
Fastify Reference App boundary
        |
        +--> Supabase Auth (loopback local or confirmed hosted project)
        |
        +--> ReferenceAppServer -> Account/Project/Audit Services
                                             |
                                             v
                                PostgreSQL/RLS (loopback or TLS session pooler)
```

React never receives the Supabase service-role key, access token, refresh token, database URL or
trusted context. It can request a workspace preference, but the server validates membership before
promoting it into the transaction. It cannot select the app, owner or platform role.

## Routes

Browser routes:

- `/` — local platform overview;
- `/auth/sign-up` — account creation;
- `/auth/sign-in` — login;
- `/auth/recovery` — recovery request, PKCE callback and password replacement;
- `/app` — backwards-compatible entry to the global Dashboard;
- `/app/dashboard` — global account/portfolio foundation, independent from the active workspace;
- `/app/workspace/projects` — projects in the server-validated active workspace;
- `/app/workspace/activity` — activity in the server-validated active workspace;
- `/app/settings/profile` — profile, e-mail display, language and timezone;
- `/app/settings/organization` — current organization display name and supported rename action.

HTTP routes:

- `GET /api/health` — process liveness only;
- `GET /api/ready` — migration, seed and critical database readiness;
- `POST /api/auth/sign-up` — credentials plus optional validated onboarding profile/organization
  fields;
- `POST /api/auth/sign-in`;
- `POST /api/auth/refresh`;
- `POST /api/auth/sign-out`;
- `POST /api/auth/recovery`;
- `POST /api/auth/recovery/exchange`;
- `POST /api/auth/recovery/complete`;
- `GET/PATCH /api/me`;
- `GET/POST /api/workspaces`;
- `PATCH /api/workspaces/current` — rename a selected shared organization for a verified owner or
  administrator;
- `POST /api/workspaces/select`;
- `GET/POST /api/workspaces/members`;
- `GET/POST /api/projects`;
- `GET /api/audit`;
- `GET /api/projects/:id`;
- `POST /api/projects/:id/archive`;
- `POST /api/projects/:id/delete`.

The browser cannot send `appCode`, `app_id`, `owner_user_id`, a platform role or arbitrary extra
fields through accepted project payloads. Its HttpOnly workspace cookie is validated against
active membership on every Project/Audit Service transaction. Project, Workspace, Audit and
account services still repeat explicit authorization and PostgreSQL still applies RLS.

## Frontend information architecture

The authenticated shell now separates two scopes:

- `Dashboard` is the global account/portfolio page. Its frontend contract defaults to
  `ALL_WORKSPACES` and already supports a future `SELECTED_WORKSPACES` mode with
  `selectedWorkspaceIds[]`. Changing the active workspace does not redefine this Dashboard scope.
- workspace pages are operational and derive their projects/activity exclusively from the
  server-validated active-workspace cookie.

The sidebar owns workspace selection and secondary creation. Its accessible menu lists only
workspaces returned by `GET /api/workspaces`; selecting one still calls the protected selection
endpoint. Creation happens in a modal, validates the name, prevents repeat submission, remains open
on failure and uses the existing response/cookie behavior to select the new workspace. Profile
content no longer appears on the Dashboard and infrastructure/security status is not promoted in
the normal product UI.

Settings currently contains Profile and Organization. Profile persists `displayName`,
`preferredLanguage`, `preferredLocale` and the IANA timezone through the existing account contract.
The e-mail comes from the verified session and remains read-only. Organization shows product-facing
name/type/role without exposing UUIDs or tenant identifiers.

## Signup and current i18n boundary

Signup is a small two-step flow: Account (`displayName`, e-mail and password), then Setup (language,
IANA timezone and initial organization name). Browser locale/timezone detection supplies editable
defaults and falls back safely. The server accepts those bounded fields, validates the profile with
`AccountService`, and passes the initial name to the existing
`hive.ensure_personal_organization(text)` helper. Owner/app/organization IDs and administrative
roles remain server-derived.

`@green-hive/i18n` is still `SCAFFOLD_ONLY`; this slice does not introduce a competing translation
runtime. It persists the user's language/locale preference for the future GH-0701 implementation,
while current interface copy remains Portuguese. Renaming an already-created personal organization
also remains a documented dependency: the immutable helper does not change the name on conflict and
the current organization update policy intentionally covers shared workspaces only.

## Session and request security

- Access and refresh tokens use `HttpOnly`, `SameSite=Lax`, host-only cookies with `Path=/`.
- `Secure` is enabled automatically when the configured application origin uses HTTPS. Local HTTP
  is the explicit development exception.
- Authenticated and Auth route responses use `Cache-Control: private, no-store`.
- Every mutating API request must carry the exact configured `Origin` and JSON content type.
- Request bodies are limited to 32 KiB and public error responses contain stable codes only.
- The HTTP layer sends CSP, frame denial, MIME-sniffing protection, referrer, permissions and
  cross-origin opener headers.
- The server is bound to the configured hostname; local preview mode refuses anything except the
  canonical loopback application, Auth and database endpoints.
- Hosted mode binds to Render's private `0.0.0.0:$PORT` listener while retaining the exact public
  HTTPS origin for mutation checks. It rejects local, cross-project and non-TLS configuration.
- Hosted HTTPS responses include HSTS. Readiness failures are `503` responses without provider or
  database details.
- React uses neither `localStorage` nor `sessionStorage` for authentication.

## Password recovery

Recovery uses Supabase's PKCE flow. The server creates the verifier and stores its opaque state in
a short-lived HttpOnly cookie. The email redirects with a single-use authorization code and flow
identifier. The server exchanges them, consumes the verifier state and only then writes the normal
session cookies. Access and refresh tokens never appear in the callback URL.

The local flow sends mail exclusively to Mailpit. Hosted test recovery will be sent by Supabase
Auth to Mailtrap; SMTP credentials never enter the application host or this repository.

## Local operation

```text
npm ci
npm run reference-app:start
```

Open `http://127.0.0.1:3000`. The start command verifies the protected Supabase stack, reapplies
the immutable migration ledger, synchronizes the structural seed, builds TypeScript and React, and
then runs the HTTP application in the foreground.

Stop the application with `Ctrl+C`. Stop the supporting stack separately with:

```text
npm run supabase:stop
```

## Validation

`npm run web:test:supabase` executes a native local HTTP matrix with two disposable users. It
proves protected cookies, owner profile update, server-derived project ownership/app/workspace,
forged scope rejection, same-app cross-user denial, cross-workspace isolation, foreign workspace
selection denial, exact-origin rejection, tenant-safe Audit reads, confidential-payload exclusion,
archive, logical deletion and logout. Cleanup removes only the exact users, workspaces, projects
and Audit events created by that run.

The UX slice adds unit contracts for global/workspace routes, portfolio scope, smart signup
defaults, omission of profile/infrastructure status from Dashboard, accessible workspace-menu
semantics, the creation dialog and the two-step onboarding fields. Visual browser inspection covers
signup, Dashboard, workspace projects, Profile and Organization settings at desktop and mobile
viewports.

## Hosted completion

The dedicated Supabase staging project and CI-gated Render service pass the server-side signup,
session, cross-user, cross-workspace and owned-project flow through protected HTTPS cookies.
Hosted PKCE recovery is completed through Supabase custom SMTP and Mailtrap. GH-0201 and GH-0202
are `DONE`. GH-0204 has a locally validated bounded rate-limit implementation and remains
`PARTIAL - IMPLEMENTATION_PASS` until its exact-target abuse gate passes on the deployed Render
service.
