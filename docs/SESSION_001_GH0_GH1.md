# Session 001 — GH-0 / GH-1 Bootstrap

Date: 2026-08-18

## Objective

Start implementation of Green Hive from Platform Specification 1.0 without prematurely adding external providers or application-domain code.

## Delivered

- canonical Green Hive repository identity;
- npm workspaces monorepo;
- TypeScript project references;
- all planned Green Hive package directories;
- `hive-reference-app` and `hive-admin` placeholders;
- concrete `AppManifestV1` contract;
- runtime App Manifest validation;
- in-memory App Registry with duplicate protection;
- valid `REFERENCE_APP` manifest;
- stable initial Hive error codes;
- public package contract placeholders for future phases;
- platform boundary/secret lint;
- format check;
- native unit tests for App Contract;
- database folders and canonical GH_MIG_001–003 handoff.

## Validation result

Local validation passed:

```text
format:check PASS
platform lint PASS
typecheck PASS
build PASS
unit tests 4/4 PASS
```

The current execution environment cannot reach the npm registry. For local verification, workspace resolution was temporarily linked in ignored `node_modules`. The archive excludes that directory.

## Backlog status

- GH-0001 — DONE
- GH-0002 — DONE
- GH-0101 — PARTIAL (requires clean online install + lockfile/CI verification)
- GH-0102 — NEXT
- GH-0103 — NEXT
- GH-0104 — after database/RLS baseline

## Next implementation slice

Implement `GH_MIG_001`, `GH_MIG_002`, and `GH_MIG_003` together with database security tests. The checkpoint is not merely “tables exist”; it is:

> User A can create/read their REFERENCE_APP project and User B cannot read, update, or delete it.
