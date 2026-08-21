# 27 — Green Hive v1 Definition of Done

Green Hive v1 is considered ready only when all of the following are demonstrably true:

1. A new application can be registered through the App Contract.
2. A user can register, authenticate and maintain a BeeGreen account profile.
3. The user can create a project bound to one app.
4. Cross-user project access is denied at API and RLS levels.
5. Cross-app project leakage is prevented.
6. A product/price can be registered and purchased in sandbox/test billing.
7. Signed/verified webhooks update payment state idempotently.
8. A project entitlement can be granted and checked server-side.
9. Usage budgets can be reserved, consumed and released atomically.
10. Usage and monetary cost events are separately recorded.
11. A generic job can be queued, claimed, retried appropriately and completed idempotently.
12. Fake AI provider works in local/CI.
13. One real AI provider works through the Gateway in staging.
14. Structured AI output is runtime-schema validated.
15. Trust Policy can allow, sanitize, confirm or deny external processing.
16. A private generated file can be stored and downloaded only through authorized signed access.
17. Audit events and correlation IDs allow operational tracing.
18. Feature flags/kill switches can disable selected capabilities.
19. Admin can inspect payments, entitlements, failed jobs, costs and provider health without unrestricted app-content access by default.
20. Local, staging and production are isolated.
21. CI validates code, migrations, RLS/security and build.
22. Automated backup exists and a restore has been successfully tested.
23. Reference App E2E flow passes in staging.
24. P0 runbooks are usable.
25. No P0 release gate remains open.

This Definition of Done is stricter than “the code exists.” It is the release contract for using Green Hive as the foundation of a production application.
