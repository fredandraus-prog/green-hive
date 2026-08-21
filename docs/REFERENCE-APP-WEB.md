# Reference App web and HTTP boundary

## Purpose

Platform version `0.7.0` extends the Reference App with tenant-aware workspace and Audit boundaries
while retaining the real local web application. The implementation follows the canonical React +
Vite direction and keeps privileged decisions in a Fastify server process.

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
- `/app` — authenticated profile and project shell.

HTTP routes:

- `GET /api/health` — process liveness only;
- `GET /api/ready` — migration, seed and critical database readiness;
- `POST /api/auth/sign-up`;
- `POST /api/auth/sign-in`;
- `POST /api/auth/refresh`;
- `POST /api/auth/sign-out`;
- `POST /api/auth/recovery`;
- `POST /api/auth/recovery/exchange`;
- `POST /api/auth/recovery/complete`;
- `GET/PATCH /api/me`;
- `GET/POST /api/workspaces`;
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

The UI shell was also opened and visually inspected at `/` and `/auth/recovery`, with no browser
console warnings or errors.

## Remaining gate

The dedicated Supabase staging project now passes the server-side signup, session, cross-user and
owned-project core. The Render runtime, Blueprint, CI and readiness contract pass locally, but no
service has been created. GH-0201 and GH-0202 remain `PARTIAL` until the same flow passes through
the deployed HTTPS/cookie boundary and hosted password recovery is completed through Mailtrap.
