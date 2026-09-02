# GH-0505 — Search Provider and deterministic fake Search Gateway

Status: `PARTIAL — IMPLEMENTATION IN PROGRESS; NO ACCEPTANCE GATE RECORDED`.

## Objective

Create a reusable, provider-neutral Search contract that can execute end to end without a real
Search provider. The checkpoint must prove strict runtime boundaries, deterministic zero-network
behavior, exact Trust and Cost Guard enforcement, metadata-only operation tracking and tenant
isolation while introducing no provider account, API key or paid call.

The canonical dependency remains `GH-0502,GH-0402`. GH-0504 is not a dependency and remains
separately `PARTIAL` until its controlled real AI staging gate can be funded and completed.

## Implementation scope

The in-progress slice is limited to:

- provider-neutral `SearchProvider.search(SearchProviderRequest)` and normalized result contracts;
- deterministic `FakeSearchProvider` with controlled safe failures and zero network access;
- strict request, provider-result, registry and context validation;
- `SearchGatewayService.execute` and a server-owned `SearchGatewayRegistry`;
- app-prefixed Search types, trusted classification and application-owned `ABSTRACT_QUERY`
  sanitization;
- mandatory `SEARCH_QUERY` Trust Policy evaluation with fail-closed gaps;
- server-owned capability, provider, exact-decimal cost, maximum-result and bounded-retry
  configuration;
- entitlement-aware Cost Guard reservation plus atomic accounted success or failure, including
  logical Search usage on success and reservation release on failure;
- immutable migration `0022` for metadata-only `hive.search_operations` lifecycle evidence;
- owner/admin limited-read RLS, server-only writers and minimized terminal Search Audit events;
- unit, embedded PostgreSQL and guarded native Supabase validation paths;
- platform release target `0.22.0`, while the `REFERENCE_APP` product manifest remains `0.1.0`.

Every normalized provider result is marked `UNTRUSTED_EXTERNAL_DATA`. Ranked result titles and
snippets are bounded text, and result URLs must use HTTPS. None of those values becomes trusted
HTML, an authorization input or persisted operation/Audit metadata.

## Migration and storage boundary

Migration `0022` is planned to create `hive.search_operations`, server-only start, accounted
success/failure and unreserved-failure functions, a private lower-level completion helper, terminal
Audit capture and tenant-aware read-only RLS. Accounted success and failure require the matching
reservation estimate to equal the operation estimate. The simple failure writer refuses any
operation that has a reservation. The migration may persist scope, registered operation
configuration, Trust decisions, counts, exact internal accounting amounts, cache status, a query
fingerprint, terminal state and safe error metadata.

The start writer validates app ownership through a literal prefix comparison against the complete
signed app code followed by `_`; it does not split identifiers at underscores.

It must never persist a raw or sanitized query, title, URL, snippet, complete provider result,
provider response body or secret. Authenticated owners and platform administrators may read only
the reviewed bounded columns. They cannot create, mutate or physically delete Search operations or
invoke lifecycle writers. Published migrations `0001` through `0021` cannot be edited.

The fake composition uses positive, exact internal accounting values to exercise Cost Guard. The
estimate is `request unit cost * maximum attempts + result unit cost * maximum results`; the actual
successful cost is `request unit cost * physical provider attempts + result unit cost * returned
results`. Every retry counts as another physical provider call. Those values are not external
spending. The fake path makes no network call and its cache state is always `NOT_APPLICABLE`;
GH-0505 does not implement a cache.

## Acceptance evidence required for `DONE`

GH-0505 can move from `PARTIAL` to `DONE` only after evidence demonstrates all of the following:

1. provider, gateway, registry, operation and error contracts pass strict runtime validation;
2. identical fake requests produce deterministic, deeply isolated normalized results;
3. every result is marked `UNTRUSTED_EXTERNAL_DATA`, uses bounded text and contains only HTTPS URLs;
4. tests prove zero calls to `fetch`, sockets or any real Search provider;
5. caller-controlled provider, capability, price, currency, limit and tenant authority are rejected;
6. the exact `SEARCH_QUERY` Trust matrix, `ABSTRACT_QUERY` sanitizer and sensitivity ceiling are
   enforced, including fail-closed policy gaps, confirmation-required and denied outcomes;
7. Cost Guard reservation, retry-aware exact cost, failure release, idempotency and logical Search
   usage have one consistent economic effect; successful reservation consumption, usage recording
   and terminal completion are atomic, while post-reservation release, failed transition and Audit
   are also atomic;
8. migration `0022` has valid metadata/checksum, applies after `0021` and reapplies without drift;
9. Search operation lifecycle, terminal Audit capture and owner/admin limited-read RLS pass embedded
   and native Supabase tenant-isolation tests;
10. cross-user, cross-organization, cross-app, forged-scope, browser-write and physical-delete paths
    remain denied;
11. query/result/provider bodies and secrets are absent from operation, Usage/Cost and Audit stores;
12. clean install, focused tests, full `verify`, database validation, dependency audit and release
    manifest verification pass;
13. feature push, pull-request and merged-main CI pass, followed by the existing Render Free
    readiness and public HTTPS/security smokes;
14. honest release evidence, final source manifest, extracted source-only ZIP and tag for platform
    `0.22.0` are completed.

No item in this list may be marked as passed in advance. The paid GH-0504 command is explicitly not
part of the GH-0505 acceptance gate.

## Deferred scope

GH-0505 does not add a real Search provider, paid Search subscription, Search secret, provider
selection UI, public Search endpoint, user-facing Search page, web crawler, arbitrary scraping,
persistent result cache, Redis, vector database, embeddings, semantic search, full-text project
index, AI/Search composition or consumer-domain workflow.

It also does not execute the GH-0504 OpenAI staging command or promote GH-0504 to `DONE`.

## Recovery

Source recovery disables the Search Gateway composition and returns consumers to the previous
`@green-hive/search` placeholder while leaving unrelated AI behavior unchanged. The fake provider
has no account, credential, remote resource or external data to revoke.

Migration `0022` recovery must prefer a forward fix. Before any controlled restoration, export and
reconcile Search operation metadata, Cost Guard reservations/decisions, Usage/Cost evidence, Audit
events and the migration ledger. Raw queries and results should not exist in storage and therefore
must not be reconstructed from operational evidence.
