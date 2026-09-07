# GH-0704 — Stable Error Taxonomy and Client Mapping

## Delivered

- Typed `@green-hive/core` public error taxonomy with deliberate published
  codes, categories, status and retryability.
- One HTTP mapping path for Reference App routes, rate limits and API not-found
  replies.
- Safe fallback for unknown errors: `INTERNAL_ERROR` without source messages,
  stack traces, database details, tokens or other diagnostic payloads.
- Reference App client mapping that builds Portuguese messages from the public
  code/category and ignores a server-supplied message.
- Unit and HTTP coverage for classifications, rate limiting, client mapping
  and prevention of raw implementation-detail exposure.

## Deliberate boundaries

- No new API operation, database migration, RLS change, provider integration,
  external logging, error-tracking account or browser secret.
- Domain error classes remain local to their packages. GH-0704 only defines
  their safe public transport boundary.
- The generic transport message is not a localization system. The client
  mapping is the presentation layer and remains independent of authorization.

## Acceptance evidence

The focused unit/HTTP matrix proves that a known error keeps a stable contract,
that `RATE_LIMITED` is retryable, and that a synthetic SQL/provider failure is
returned only as `INTERNAL_ERROR`. `npm run verify --silent` runs the complete
clean repository gate before release.
