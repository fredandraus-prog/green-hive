# GH-0502 — Trust Policy Foundation

## Delivered

- four canonical data classifications and external-processing defaults;
- canonical `EXTERNAL_PROVIDER`, `SEARCH_QUERY` and `LOG` policy matrix;
- stable `ALLOW`, `ALLOW_WITH_SANITIZATION`, `REQUIRE_CONFIRMATION` and `DENY` decisions;
- explicit process, sanitize, confirm and block actions;
- context-minimization, query-abstraction and metadata-only sanitization directives;
- deny-by-default behavior for every unconfigured combination;
- controlled provider/confidential-mode overrides with highly confidential guardrails;
- strict trusted-context, evaluation-input and configuration validation;
- tests for policy decisions, forged/raw input, confirmation and invalid policies.

## Acceptance status

GH-0502 is `DONE`. Local implementation, focused tests, the complete clean gate, both GitHub
push/PR pipelines, existing Render build/readiness and the exact public HTTPS smoke pass. No
dedicated Supabase mutation or matrix was required because the checkpoint adds no migration, seed,
database policy store or hosted route; all twenty published migrations remain unchanged.

## Boundaries

This service decides required handling from trusted metadata. It does not inspect raw content,
infer PII/secrets, authorize project access, transform app semantics, collect/verify confirmation,
select a model/provider, call AI/Search, persist decisions or expose a browser API. AI Gateway
enforcement and runtime output schemas remain GH-0503; a real provider remains GH-0504.

## Recovery

GH-0502 is source-only. Rollback means returning coordinated packages from `0.19.0` to validated
tag `v0.18.0`. No database rollback, data repair or provider-key revocation is involved.
