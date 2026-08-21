# GH-0203 — Audit Foundation

Status: `DONE` on 2026-08-20.

## Delivered

- immutable migration `0011_create_audit_events.sql`;
- append-only `audit.events` with tenant/app/project relationships;
- request/correlation identifiers generated for authenticated database transactions;
- transactional organization, membership, installation and project lifecycle capture;
- no duplicate archive/delete events for idempotent retries;
- bounded metadata with confidential-key and size constraints;
- authenticated read-only grants and tenant-aware RLS;
- safe platform-admin operational metadata without private project/profile access;
- typed `@green-hive/audit` contracts, validation, service, errors and PostgreSQL repository;
- protected `GET /api/audit` Reference App endpoint and recent-activity panel;
- explicit test-fixture cleanup without weakening production append-only grants.

## Acceptance evidence

- migration and ledger validation: 11 immutable migrations;
- embedded PostgreSQL/PGlite RLS matrix: PASS;
- unit/App Manifest/HTTP tests: PASS, including Audit Service and protected endpoint;
- local Supabase database/RLS matrix: PASS;
- local Project/Workspace/Audit Service matrix: PASS;
- local Auth and HTTP/cookie matrices: PASS;
- dedicated hosted staging migration, database/RLS, service and Auth matrices: PASS;
- staging final state: 11 ledger rows, zero pending migrations and zero disposable artifacts.

The tests prove cross-user, cross-app and cross-organization event denial; safe platform-admin
metadata reads; direct authenticated insert/update/delete denial; project create/archive/delete
capture; transaction correlation; and exclusion of project names, arbitrary metadata and credential
terms from captured payloads.

## Not included

- observability metrics/log aggregation;
- exact production retention/purge automation;
- login-failure provider hooks;
- Billing, Entitlements, Jobs, AI, Files, feature flags or provider event emission;
- external webhooks or event streaming;
- break-glass administrative content access.

GH-0201/GH-0202 remain partial only for the separate hosted HTTPS/cookie and test-SMTP recovery
gates. GH-0203 does not silently promote those checkpoints.
