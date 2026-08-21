# Security Baseline

- Never commit secrets.
- Provider credentials are server-side only.
- Project authorization will be enforced server-side and by PostgreSQL RLS.
- A Green Hive package must never trust client-supplied ownership or entitlement state.
- Cross-user project access is a release-blocking defect.
- External provider content is untrusted data.
- Audit/logging must exclude confidential payloads by default.
- Local Supabase must remain protected by loopback networking and an inbound firewall block for
  PostgreSQL port 54322; the Docker daemon remains on its local named pipe, not TCP.
- Supabase Auth and Mailpit must bind exclusively to `127.0.0.1`; startup fails on broader binds.
- Access tokens are verified with Supabase Auth before building `TrustedAppContext`; `getSession()`
  or a decoded but unverified JWT is not authorization evidence.
- App scope and platform roles come only from signed `app_metadata`; `user_metadata` is never an
  authorization source.
- The service-role key is server-only. It must never appear in a browser bundle, public environment
  variable, response body or log.
- Password recovery callbacks must match an exact allowlist entry.
- Browser sessions use HttpOnly, host-only, `SameSite=Lax` cookies. The `Secure` flag is mandatory
  on HTTPS and disabled only for the canonical loopback HTTP preview.
- React must not receive or persist access tokens, refresh tokens, PKCE verifier state, service-role
  credentials or database URLs.
- Password recovery uses PKCE so callback URLs contain a single-use code instead of session tokens.
- Mutating HTTP calls require the exact configured origin and JSON content type. Unknown body fields
  and bodies larger than 32 KiB are rejected.
- Auth/API responses are private and non-cacheable; the local boundary emits CSP, frame denial,
  MIME-sniffing, referrer, permissions and cross-origin opener headers.

Security implementation deepens in GH-2. This repository baseline already checks for obvious
secret patterns, forbidden application-domain imports, trusted Auth context and native RLS
isolation. Local HTTP headers and origin protections are now present. Deployed HTTPS, distributed
rate limiting, MFA administration, secret rotation and staging remain future gates.
