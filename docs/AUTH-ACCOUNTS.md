# Auth and accounts

## Scope

`@green-hive/auth` is the platform authority for account authentication, verified session context
and reusable BeeGreen profile preferences. Supabase Auth stores credentials and issues sessions;
Green Hive never stores passwords.

The GH-0201 local implementation provides:

- server-controlled email/password account creation;
- sign in;
- refresh-token rotation;
- local or global sign out;
- password-recovery request and password replacement;
- verified access-token lookup through the Auth server;
- conversion from verified identity to `TrustedAppContext`;
- owner profile bootstrap, read and update;
- a transaction-scoped PostgreSQL executor using the `authenticated` role;
- Reference App composition with the Project Service.

Social login, production SMTP, MFA enforcement and account export/deletion workflow are not part
of this checkpoint. The dedicated Supabase staging Auth core has passed; the public local and
prepared hosted HTTP boundaries are documented separately in `docs/REFERENCE-APP-WEB.md` and
`docs/HOSTED-STAGING.md`.

## Public contracts

The package exports provider-neutral contracts and implementations:

- `AuthUser` and `AuthSession`;
- `SignUpInput`, `SignInInput`, `RefreshSessionInput`, `SignOutInput`;
- `PasswordRecoveryInput` and `PasswordRecoveryCompletionInput`;
- `AuthProvider` and `AuthService`;
- `AccountProfile`, `AccountProfileInput`, `AccountRepository` and `AccountService`;
- `SupabaseServerAuthProvider`;
- `PostgresAccountRepository`;
- `PostgresAuthenticatedSessionRunner`;
- `createTrustedAppContext`;
- stable `AuthError` codes.

All external input is checked at runtime. TypeScript types do not replace validation.

## Trusted identity flow

```text
email/password or refresh token
        |
        v
Supabase Auth
        |
        v
signed access token
        |
        v
Auth server getUser(accessToken)
        |
        v
id + app_metadata.app_code + optional app_metadata.platform_role
        |
        v
TrustedAppContext
        |
        v
authenticated PostgreSQL transaction -> Account/Project Service -> RLS
```

The server checks the token with the Auth server for an up-to-date user record before accepting it.
It does not authorize from local storage, `getSession()`, arbitrary decoded JWT data, headers that
claim an app, request fields, query strings or `user_metadata`.

## App assignment

Signup receives an app code only inside the trusted server facade. `AuthService` checks that the app
exists in the canonical `AppRegistry`; the Supabase admin API then writes the value to
`app_metadata.app_code`. The service-role credential is encapsulated in the server adapter.

The Reference App facade hard-codes its canonical manifest code. A caller cannot override it with
`appCode`, `app_id`, owner identifiers or a platform role.

This checkpoint supports one active app claim per session. A future multi-app membership/switching
workflow must be server-controlled and must issue a fresh signed session; it may not turn a route or
form value directly into authorization context.

## Profile behavior

The first successful signup or login ensures an owner profile exists in `hive.user_profiles`.
Subsequent reads and updates run as `authenticated` inside one transaction and remain subject to
native RLS.

Allowed reusable fields are:

- display name;
- preferred language;
- preferred locale;
- timezone;
- bounded JSON preferences.

Application-specific profile data does not belong in this table.

## Password recovery

The caller supplies only an email address to the Reference App facade. The redirect destination is
trusted server configuration and must exactly match the allowlist. Recovery uses PKCE: the server
holds the verifier in a short-lived HttpOnly cookie, the email returns a single-use authorization
code, and the server exchanges that code before creating session cookies. Access and refresh tokens
do not appear in the callback URL or React state. Locally, Supabase Auth sends the message to
Mailpit; the tests follow the recovery link and replace the password through Supabase Auth.

Production SMTP and deployed callback URLs must be configured only in an explicitly authorized
staging/production environment.

## Session and logout behavior

Refresh tokens are opaque and rotated by Supabase Auth. The old refresh token must fail after a
successful rotation. Local logout revokes the current refresh session; global logout revokes all
refresh sessions for the user.

Access tokens remain valid until their encoded expiry even after logout. The application must use
short-lived access tokens and must not claim that logout can revoke an already issued stateless JWT
immediately.

## Stable errors

Public errors expose a code and safe message only. Provider response bodies, SQL text, stack traces,
table names and nested causes are not returned. Important codes include:

- `INVALID_AUTH_INPUT`;
- `AUTH_APP_NOT_ALLOWED`;
- `AUTH_SIGN_UP_FAILED`;
- `AUTH_INVALID_CREDENTIALS`;
- `AUTH_SESSION_INVALID`;
- `AUTH_SESSION_REFRESH_FAILED`;
- `AUTH_SIGN_OUT_FAILED`;
- `AUTH_RECOVERY_FAILED`;
- `AUTH_RECOVERY_EXCHANGE_FAILED`;
- `AUTH_PASSWORD_UPDATE_FAILED`;
- `ACCOUNT_NOT_FOUND`;
- `ACCOUNT_ACCESS_DENIED`;
- `INVALID_ACCOUNT_INPUT`;
- `ACCOUNT_OPERATION_FAILED`.

## Local operation

```text
npm run supabase:start
npm run auth:test:supabase
npm run supabase:status
npm run supabase:stop
```

The local gate obtains credentials from the project-pinned CLI without printing them. It removes
the exact disposable users, profiles, projects and Mailpit messages it creates.

## Browser and HTTP boundary

Platform `0.5.0` added the canonical React/Vite shell and a Fastify adapter around
`ReferenceAppServer`. The browser communicates only through same-origin JSON. Session tokens use
HttpOnly, host-only, same-site cookies; mutating calls require the exact configured origin. Client
payloads cannot select app, owner or administrative role.

Platform `0.6.0` additionally provisions one personal workspace during successful signup/sign-in.
Project calls run only after the authenticated database runner validates the selected active
organization membership. Auth claims still contain no client-editable organization authority.

## Hosted completion

The dedicated Supabase staging project and deployed Render boundary pass confirmed signup, login,
refresh, logout, profile, owned-project and trusted-scope tests through real HTTPS cookies. PKCE
password recovery is delivered and completed through Supabase custom SMTP and the dedicated
Mailtrap sandbox. GH-0201 is `DONE`; production SMTP, MFA and account export/deletion remain
separately reviewed future work.
