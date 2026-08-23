# Validation - GH-0204 implementation

Date: 2026-08-23.

Scope: local implementation gate for the GH-0204 Security Baseline. This record does not claim that
the Render service already runs the new limits and does not promote the platform beyond `0.8.0`.

## Preserved baseline

The slice was created from `origin/main` commit
`c294bfd574034361d2481f8545663214cd15b6c0` in an isolated worktree and branch. The pre-slice
source-only backup is:

```text
Engine/backups/green-hive-v0.8.0-pre-gh0204-20260822-234843.zip
SHA-256 E8CD7E815D0F3C473F72DBF6157E47DA2FD4885AB30F2DAD7851D95DD55C367D
```

The original dirty worktree, `MANIFEST.csv`, published migrations and previous release ZIPs were
not modified.

## Implemented boundary

- bounded fixed-window limits for sign-up, sign-in, recovery, session, ordinary API and expensive
  API routes;
- independent principal, source and process-wide ceilings;
- HMAC-only bucket identities with a random process-local secret;
- a 10,000-bucket cap, lazy expiry and refusal of new buckets at capacity;
- a stable public `429 RATE_LIMITED` contract with standard limit and retry metadata;
- health and readiness exemptions;
- hardened cross-origin, DNS-prefetch, cross-domain-policy and CSP headers;
- built-client scanning for private database, service-role and trust-anchor material;
- exact-target hosted abuse gate that cannot point to an arbitrary host.

This slice does not implement Redis or another distributed quota, Billing, AI, Jobs, external
webhooks, remote storage, MFA administration or secret rotation.

## Local evidence

The following gates passed from a clean dependency installation in the isolated worktree:

| Gate | Result |
|---|---|
| `npm ci` | pass; 149 packages; zero reported vulnerabilities |
| `npm run format:check` | pass |
| `npm run lint` | pass; 234 files scanned and package boundaries valid |
| `npm run security:scan` | pass; no credential files, high-confidence secrets or browser leaks |
| `npm run typecheck` | pass |
| `npm run test:unit` | pass; 77 tests, zero failures |
| `npm run db:validate` | pass; 11 immutable migrations, 9 RLS tables and seed isolation |
| `npm run db:test` | pass; 9 tests, zero failures |
| `npm run build` | pass |
| `npm run security:smoke` | `SECURITY_BUNDLE_SMOKE_PASS`; 4 built files; private secrets absent |
| `npm run verify` | pass |
| `npm audit --audit-level=high` | pass; zero vulnerabilities |

The rate-limit tests additionally prove normalized account scope, resistance to forwarded-address
rotation for an account, a wider source ceiling against account rotation, session-scoped expensive
routes, unthrottled probes, bounded memory, lazy expiry and rejection of zero-sized safeguards.

## Remaining external gate

GH-0204 remains `PARTIAL - IMPLEMENTATION_PASS`. After this implementation is reviewed, merged and
deployed, all of the following must pass against the exact Render origin:

1. `HOSTED_SECURITY_SMOKE_PASS`;
2. the ordinary hosted health/readiness/security-header smoke;
3. the complete disposable authenticated acceptance matrix;
4. cleanup verification for users, tenant rows and Mailtrap messages.

Only after those results exist may the checkpoint become `DONE` and the platform release advance to
`0.9.0`. A distributed store remains a future scale-out gate because the current Render topology is
single-instance.
