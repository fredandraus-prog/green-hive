# Search provider and gateway contracts

Status: `GH-0505 DONE — DETERMINISTIC FREE PROVIDER AND DEPLOYED ACCEPTANCE PASS`.

GH-0505 implements the first reusable Green Hive Search boundary. The slice combines a
provider-neutral contract, a deterministic fake provider, server-owned gateway composition and
tenant-safe operation metadata. It must be fully usable in development and CI without a network
request, provider account, API key, payment method or paid credit.

## Provider contract

`@green-hive/search` owns the planned public Search surface:

- `SearchProvider.search(SearchProviderRequest)`;
- `SearchProviderResult` with one physical request per provider invocation and a normalized result
  count;
- ranked results containing a title, an HTTPS URL and a bounded text snippet;
- `contentTrust = 'UNTRUSTED_EXTERNAL_DATA'` on every provider result;
- strict runtime validation for requests, results, limits and provider failures;
- stable Search errors that do not expose a query, result body, provider response or stack trace;
- deterministic `FakeSearchProvider` behavior with no network access.

Provider output is data, never trusted markup or authorization evidence. A consumer must keep the
untrusted-content marker, render title and snippet as escaped text, and treat every URL as an
external destination even after its HTTPS shape has been validated.

## Authority and registry boundary

`SearchGatewayService.execute` is the planned server-only orchestration boundary.
`SearchGatewayRegistry` owns the configuration used by that service. Application input may identify
an app-prefixed registered `searchType`, a project, a server-created Search budget, a unique
operation identity, a bounded query and its trusted classification. It cannot select or override:

- organization, app or owner authority;
- the provider or provider account;
- capability code;
- request or result unit prices;
- currency;
- maximum result count;
- bounded retry policy and retryable provider-error classes;
- Trust Policy or sanitization behavior;
- operation storage fields or cache status.

The Gateway revalidates `TrustedAppContext`, project scope and the server-owned registry before any
provider call. Platform administrators do not reuse the owner execution path. Unknown app/search
registrations and inconsistent configurations fail closed during composition or execution.
The SQL start boundary verifies the namespace by comparing the literal signed app code followed by
`_` with the beginning of both `searchType` and capability code. It does not split on `_`, so app
codes that contain underscores retain their complete namespace.

## Trust and execution order

Every query is evaluated using the existing `SEARCH_QUERY` Trust operation before it reaches a
provider. The published Trust matrix requires `ABSTRACT_QUERY` for confidential Search data and
denies highly confidential Search data. Policy gaps continue to deny. A permitted fake-provider
composition therefore needs an exact, reviewed provider-specific policy where the canonical matrix
does not already allow execution; it cannot create a broad fallback.

Only an application-owned Search sanitizer registered for the task may perform the required
`ABSTRACT_QUERY` transformation. The Gateway must not pretend to sanitize data generically. A
`REQUIRE_CONFIRMATION` decision is a distinct safe failure in this slice because GH-0505 does not
implement a confirmation collection or persistence workflow.

The intended order is:

```text
trusted context + strict Search input
  -> registered search type and sensitivity ceiling
  -> server-owned provider/capability/cost/result limits
  -> exact SEARCH_QUERY Trust decision and registered sanitizer
  -> metadata-only Search operation start
  -> entitlement-aware atomic Cost Guard reservation
  -> one or more bounded provider attempts
  -> strict result and UNTRUSTED_EXTERNAL_DATA validation
  -> atomic reservation consumption + logical Search usage + terminal Search operation
  -> minimized terminal Audit event
```

Successful economic completion is delegated to
`hive.complete_search_operation_accounted(...)`. The function locks and verifies the pending Search
operation and its reservation, consumes the reservation, records the logical usage event and marks
the operation `SUCCEEDED` in one database transaction. If any part fails, the whole completion is
rolled back. It accepts the reservation only when its `estimated_amount` exactly equals the Search
operation's `estimated_cost`.

Failure after a reservation is delegated to
`hive.fail_search_operation_accounted(text, uuid, text)`. It verifies the same estimate invariant,
releases that reservation, marks the operation `FAILED` and causes the minimized failure Audit event
inside one transaction. Failure before any reservation uses `hive.fail_search_operation(text,
text)`, which refuses to transition an operation if any matching reservation exists. Provider,
Trust, operation and accounting failures must not leak raw query or result data.

## Cost and usage semantics

Search pricing is exact-decimal, server-owned configuration. Given request unit cost `R`, result
unit cost `S`, maximum attempts `A` and maximum results `M`, the reserved estimate is
`R * A + S * M`. On successful completion, given the number of physical provider invocations `P`
and validated results returned `N`, the actual amount is `R * P + S * N`. Every retry is another
physical provider invocation and therefore increments `P`; an individual `SearchProvider.search`
result continues to report exactly one request for that one invocation. These positive amounts
exercise the existing Cost Guard and Usage/Cost contracts; for `FakeSearchProvider` they are
internal accounting values, not a provider invoice or an external charge.

A terminally failed fake operation has no recorded actual cost or logical usage. If a reservation
exists, its release and the failed operation/Audit transition are atomic. Defining reconciliation
for provider-charged failed requests is a prerequisite for a future real Search adapter and remains
outside this zero-provider checkpoint.

The Search budget type and logical usage remain distinct from provider billing. Reusing an
operation identity with different input must fail rather than create a second economic effect.
Successful retry/idempotency behavior preserves one reservation, one atomic consumption, one
logical Search usage record and one terminal Search operation while retaining the physical attempt
count.

## Migration `0022` and operation metadata

The immutable migration `0022` creates `hive.search_operations` and its server-only
lifecycle writers. The row stores only bounded operational evidence:

- organization, app, project and owner scope;
- operation identity and app-prefixed Search type;
- capability and provider codes;
- data classification, Trust policy/decision and sanitization mode;
- maximum result count plus actual request/result counts;
- exact estimated and actual internal accounting cost and currency;
- cache status, limited to the registered lifecycle values;
- SHA-256 query fingerprint;
- status, stable safe error and timestamps.

Raw or sanitized queries, titles, URLs, snippets, provider bodies and complete result objects are
prohibited from `hive.search_operations`, Usage/Cost metadata and Audit metadata. The initial fake
path does not implement a cache, so its cache status remains `NOT_APPLICABLE`; `MISS` and `HIT` are
reserved lifecycle values, not claims that caching exists in this slice.

Authenticated owners receive only a limited read view under exact organization/app/project scope.
Platform administrators may inspect the bounded operational columns but remain read-only.
Authenticated clients receive no insert, update, physical delete or lifecycle-function permission.
Only `service_role` may start an operation, invoke the accounted completion function or select the
applicable accounted/unreserved failure function. The simple failure function accepts only an
operation for which no reservation exists. Both accounted terminal functions require a matching
reservation whose estimate exactly equals the operation estimate. The lower-level
`hive.complete_search_operation(...)` transition helper is private: it is used only inside
`hive.complete_search_operation_accounted(...)` and is not executable by `service_role`,
`authenticated` or `PUBLIC`. Terminal transitions emit minimized
`SEARCH_OPERATION_COMPLETED` or `SEARCH_OPERATION_FAILED` Audit evidence for subject type
`SEARCH_OPERATION`.

Migration `0022` must have parseable metadata, a registered SHA-256 checksum and a forward-fix
recovery strategy. Published migrations `0001` through `0021` remain immutable.

## Fake provider boundary

`FakeSearchProvider` is the only provider required by GH-0505. Each invocation must return
deterministic, deeply isolated results, report exactly one physical request and a bounded result
count, preserve the untrusted-content marker and support controlled safe failure scenarios. The
Gateway aggregates every invocation, including retries, into its physical request count. Tests must
prove that no `fetch`, socket or other external provider call occurs.

There is no real Search provider, Search API subscription, provider secret, public Search HTTP/UI
feature, persistent result cache, crawler, scraping system or consumer-domain search workflow in
this checkpoint.

## Relationship to GH-0504

GH-0505 depends on completed GH-0502 and GH-0402, not on GH-0504. The controlled real AI provider
checkpoint remains `PARTIAL — REAL STAGING GATE PENDING`. No OpenAI key or paid AI call is required
or permitted as evidence for this Search slice; routine tests continue to use deterministic fake
providers.
