# GH-0104 acceptance record

## Implemented and validated

- [x] public Project, status, input, repository, service and error contracts;
- [x] runtime validation at the external service boundary;
- [x] owner and app derived only from `TrustedAppContext`;
- [x] explicit JWT/context agreement in the PostgreSQL repository;
- [x] create, list, get, idempotent archive and idempotent logical deletion;
- [x] foreign IDs hidden across user and app boundaries;
- [x] platform-admin owner writes rejected;
- [x] safe storage errors without SQL/internal details;
- [x] fake-repository unit tests;
- [x] native Supabase integration through the `authenticated` role;
- [x] unchanged migration 0001-0006 checksums and green GH-0102/GH-0103 parity gate.

## Status

GH-0104 is `DONE`. The platform version is `0.3.0`; the `REFERENCE_APP` manifest remains `0.1.0`.

## Deferred

HTTP endpoints and verified session construction wait for GH-0201. Audit emission waits for GH-0203.
Billing, AI, Redis, jobs, webhooks and all consumer-domain functionality remain outside this slice.
