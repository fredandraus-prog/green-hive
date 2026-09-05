# GH-0602 implementation validation — 2026-09-05

This evidence records the signed private-download implementation and its non-public operational
gates. The source-release manifest, archive, CI and tag are recorded separately only after those
operations are observed.

| Gate | Result |
|---|---|
| format, lint and typecheck | pass; package boundaries and the 24-migration catalog remain valid |
| focused file unit matrix | pass; owner grant, cross-user/app/admin/deleted denial, failure-before-audit and controlled `download` query handling |
| embedded `file-service.integration.test.mjs` | pass; private bucket declaration, writer grants and safe `FILE_EXPORTED` evidence |
| local `files:storage:test:local` | pass; random opaque write, public-read denial, real signed read through `FileService`, `finally` cleanup |
| staging migration/seed apply | pass; only `0024` applied, ledger `24`, seed replayed, no schema or user deletion |
| staging `staging:files:storage:test` | pass; the same disposable private Storage path completed in 3.5 seconds |
| staging native RLS matrix | pass; 13 core RLS/Audit, 10 Project/Workspace, Billing, Entitlements, Usage/Cost, Cost Guard, Jobs, Worker and AI native scenarios shown passing after migration |

The Storage probe creates an opaque `ghf/<sha256>` key with non-sensitive text. It does not print
the signed URL or any credential, uses the configured private bucket only, proves the public object
endpoint rejects access, and removes the object in a `finally` block even if signing or reading
fails. The staging runner accepts only the explicit, project-bound `SUPABASE_STAGING` confirmation
and uses its protected service credential only inside the process.

No browser upload, public bucket, permanent URL, CDN, generic rendering, Worker composition,
external paid API or real OpenAI provider call is part of GH-0602.
