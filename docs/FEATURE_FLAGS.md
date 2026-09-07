# Feature Flags

GH-0703 provides a small, typed and deterministic rollout contract in
`@green-hive/feature-flags`. It is deliberately not a remote configuration
system, an authorization mechanism or a client-side source of truth.

## Registration

An application first declares its namespaced codes in `AppManifestV1.featureFlags`
and includes `FEATURE_FLAGS` in `requiredCapabilities`. `FeatureFlagRegistry`
accepts only configurations for those declared codes; duplicate or foreign codes
are rejected while the process starts.

## Evaluation

Evaluation accepts only `TrustedAppContext`, which must have been derived by a
server from a verified session or signed JWT. Header values, query parameters,
browser storage, form payloads and environment variables are not valid context
sources.

| State | Result |
| --- | --- |
| `OFF` | Always disabled. This is the local kill switch. |
| `INTERNAL` | Enabled only for `PLATFORM_ADMIN`. |
| `BETA` | Enabled only for an explicitly listed user or organization/workspace. |
| `PUBLIC` | Enabled for the registered app. |

An app-code mismatch always disables the flag. Unknown codes also resolve to a
safe disabled decision. Flags are rollout controls only: they must never grant
data access, bypass RLS, select an app/workspace, or replace explicit server-side
authorization.

## Administrative hook and boundaries

`createFeatureFlagAdminHook()` exposes a read-only, platform-admin-only list of
the effective local configuration. It deliberately has no persistent mutation:
there is no admin UI, database table, remote fetch, cache, analytics exposure or
live multi-instance configuration in GH-0703. A later checkpoint may add a
reviewed persistent administration path with audit evidence and a new immutable
migration; it must retain the same manifest and trusted-context boundaries.
