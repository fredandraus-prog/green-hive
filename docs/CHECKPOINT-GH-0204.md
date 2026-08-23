# GH-0204 - Security baseline

Status: `DONE` in platform `0.9.0`.

The exact hosted security smoke, ordinary public smoke and complete authenticated acceptance matrix
passed on 2026-08-23 against Render merge commit
`67b55cfb4268312a7ba146f40811af7b499866e5`. The final run removed its test-owned Auth/database
fixtures and the single Mailtrap recovery message.

## Scope

This slice adds the missing baseline from `SEC_011`: repeated Auth or expensive requests cross a
bounded threshold and receive a stable `429`. Existing exact-origin CSRF, HttpOnly/Secure cookies,
PKCE recovery, RLS, no-store responses, dependency/secret scanning and security headers remain
release gates.

It does not add Redis, Render Key Value, a distributed quota, Billing, AI, Jobs, external webhooks,
MFA administration or automated secret rotation.

## Default route policies

| Policy | Routes | Principal limit | Window |
|---|---|---:|---:|
| `AUTH_SIGN_UP` | `POST /api/auth/sign-up` | 5 | 15 minutes |
| `AUTH_SIGN_IN` | `POST /api/auth/sign-in` | 10 | 15 minutes |
| `AUTH_RECOVERY_REQUEST` | `POST /api/auth/recovery` | 3 | 60 minutes |
| `AUTH_RECOVERY_EXCHANGE` | `POST /api/auth/recovery/exchange` | 10 | 15 minutes |
| `AUTH_RECOVERY_COMPLETE` | `POST /api/auth/recovery/complete` | 5 | 15 minutes |
| `AUTH_SESSION` | refresh and sign-out | 30 | 15 minutes |
| `API_EXPENSIVE` | Audit and member listing | 30 | 1 minute |
| `API_STANDARD` | remaining `/api/*` routes | 120 | 1 minute |

Each policy also has a source ceiling at ten times the principal limit and a process-wide ceiling at
one hundred times the principal limit. Rotating e-mails or cookies therefore does not remove every
bound. Health and readiness are exempt so an abuse bucket cannot make the platform fail its hosting
health check.

## Privacy and memory boundary

- e-mail addresses, session cookies, recovery state and source addresses are never map keys;
- a random process-local 256-bit secret HMACs every principal and source key;
- only the policy name, digest, count and reset timestamp remain in the bucket map;
- the map is capped at 10,000 buckets and refuses new buckets when full;
- expired fixed-window buckets are removed lazily without timers;
- a process restart clears the counters and generates a new HMAC secret;
- rate limiting is defense in depth and never grants authorization.

The first valid address from Render's forwarding chain is used only as a supplemental abuse bucket.
Account/session buckets and the global process ceiling remain independently enforced; forwarding
metadata is never trusted for user, app, workspace, role or entitlement decisions.

## Public contract

Limited routes return:

- `RateLimit-Limit`;
- `RateLimit-Remaining`;
- `RateLimit-Reset`;
- `RateLimit-Policy`;
- `Retry-After` on denial;
- HTTP `429` with `RATE_LIMITED` and no internal identifiers.

The HTTP boundary also emits `Cross-Origin-Resource-Policy: same-origin`, disables DNS prefetch and
cross-domain policy files, and adds `object-src 'none'` to CSP.

## Gates

Local:

```text
npm ci
npm run verify
npm audit --audit-level=high
npm run release:verify-manifest
```

Hosted release gate:

```powershell
$env:GREEN_HIVE_HOSTED_APP_ORIGIN = "https://green-hive-staging.onrender.com"
$env:GREEN_HIVE_HOSTED_SECURITY_CONFIRM = "EXERCISE_STAGING_RATE_LIMIT"
npm run hosted:security
Remove-Item Env:GREEN_HIVE_HOSTED_APP_ORIGIN
Remove-Item Env:GREEN_HIVE_HOSTED_SECURITY_CONFIRM
```

The hosted gate uses a unique nonexistent e-mail, makes no account, writes no database row and sends
no message. It proves ten guarded failures, a stable eleventh-request `429`, an independent account
bucket, security headers and unthrottled health probes.

## Completion rule

`HOSTED_SECURITY_SMOKE_PASS`, the ordinary hosted smoke and the authenticated acceptance matrix all
pass on the exact deployment, so GH-0204 is `DONE` and the platform advances to `0.9.0`. Distributed
limiting remains a scale-out production gate, not a reason to reopen the single-instance baseline.

Official references:

- <https://render.com/docs/web-services>
- <https://render.com/articles/how-render-handles-ddos-attacks>
- <https://fastify.dev/docs/latest/Reference/Server/#trustproxy>
