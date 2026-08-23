# Green Hive Ideas Radar

This is the canonical holding area for relevant ideas that are intentionally outside the current
implementation path. An item in this file is not an approved checkpoint and must not be treated as
committed scope until its status becomes `PROMOTED` and it is linked to the operational backlog.

## Status and horizon

- `RADAR`: retained for future evaluation;
- `PLANNED`: accepted in principle, but not yet promoted to an executable checkpoint;
- `PROMOTED`: moved to the operational backlog with an explicit decision and gate;
- `REJECTED`: evaluated and intentionally declined, with the reason retained;
- `P1`: likely near-term after the current approved sequence;
- `P2`: useful medium-term extension;
- `Future`: long-term option or dependent on evidence that does not yet exist.

## Registry

| ID | Idea | Description | Why not now | Reconsideration trigger | Dependencies | Horizon | Status | Origin / related decision |
|---|---|---|---|---|---|---|---|---|
| IR-001 | Official CLI | Supported commands for app scaffolding, validation and local operations. | The manual contracts and operating model are still evolving. | Two or more external app teams repeatedly perform the same setup. | Stable public SDK, package distribution and app lifecycle. | P2 | RADAR | Shared architecture review, 2026-08-19 |
| IR-002 | Publish packages to npm | Distribute selected `@green-hive/*` packages through a registry. | Packages are private and still move in coordinated platform releases. | A separately versioned consumer must install them outside the monorepo. | Public API stability, provenance, signing and release automation. | P1 | RADAR | Shared architecture review, 2026-08-19 |
| IR-003 | Public documentation portal | Searchable, versioned external documentation. | Repository documentation is sufficient for the current single-team stage. | First external developer onboarding or public package release. | Stable public contracts and documentation release process. | P2 | RADAR | Shared architecture review, 2026-08-19 |
| IR-004 | External webhooks | Outbound event delivery to consumer systems. | Audit and event contracts are not complete and no consumer requires delivery. | A validated integration requires asynchronous external notification. | Audit events, signing, retries, idempotency and delivery observability. | P2 | RADAR | Explicitly excluded from current slices |
| IR-005 | Full OpenTelemetry and Grafana | Distributed traces, metrics and dashboards across platform services. | Current topology does not justify a full telemetry stack. | Multiple deployed services or a measured incident-response need. | Stable service boundaries and deployment topology. | P2 | RADAR | Shared architecture review, 2026-08-19 |
| IR-006 | Redis or dedicated queue | Dedicated cache and background-job transport. | There is no proven throughput or latency constraint requiring it. | Measured database contention or background workload volume exceeds the simple design. | Jobs checkpoint, operational SLOs and capacity evidence. | Future | RADAR | Explicitly excluded from current slices |
| IR-007 | Native mobile app | Dedicated mobile client for Green Hive or a portfolio app. | The web product and cross-app contracts are not yet validated. | A validated workflow requires device-native capability or offline use. | Stable HTTP API, Auth and product demand. | Future | RADAR | Shared product review, 2026-08-19 |
| IR-008 | Advanced collaboration | Comments, live presence, assignments and collaborative editing. | Workspace membership is the current foundation; collaboration behavior is product-specific. | Repeated multi-user workflows demonstrate the need. | Organizations, app permissions, Audit and Notifications. | P2 | RADAR | Shared multi-tenant decision, 2026-08-19 |
| IR-009 | Enterprise SSO | SAML/OIDC enterprise federation and managed provisioning. | No enterprise tenant or identity requirement is validated. | A qualified enterprise customer requires federation. | Organizations, Auth hardening, domain verification and Audit. | Future | RADAR | Shared product review, 2026-08-19 |
| IR-010 | Integration marketplace | Catalog of supported external connectors. | Integration contracts and ecosystem demand do not yet exist. | Three or more reusable integrations have active consumers. | Public API, webhooks, OAuth credential vault and governance. | Future | RADAR | Shared architecture review, 2026-08-19 |
| IR-011 | Pro and consultant workspaces | Commercial workspace mode for consultants managing client portfolios. | Commercial packaging and Billing have not started. | Billing model and consultant workflows are validated. | Organizations, permissions, Billing and Audit. | P2 | PLANNED | Organizations decision; business model deferred |
| IR-012 | Multiple Country Packs | Local tax, locale and regulatory packs beyond the first supported market. | No validated multi-country product requirement. | A paying app or customer enters another jurisdiction. | Country-pack contract, legal review and localization. | Future | RADAR | Shared product review, 2026-08-19 |
| IR-013 | Public API | Versioned external Green Hive API. | The server-side library and authenticated web boundary are still settling. | An external app needs supported programmatic access. | Auth completion, rate limits, Audit, versioning and API documentation. | P1 | RADAR | Shared architecture review, 2026-08-19 |
| IR-014 | BeeGreen multi-product portal | Central customer-facing portal across BeeGreen products. | Organization and app-installation foundations must be proven first. | Two production apps need a unified account and portfolio experience. | GH-0250, Auth completion and Portfolio contracts. | P1 | PLANNED | Approved portfolio direction, 2026-08-19 |
| IR-015 | Automatic cost chargeback | Attribute shared infrastructure and AI costs to organizations and apps. | There is no production cost telemetry or Billing ledger yet. | Billing and measured per-app costs are available. | Billing, Cost Guard, usage metering and Audit. | P2 | RADAR | Portfolio intelligence direction, 2026-08-19 |
| IR-016 | Forecasting and AI Insights | Forecast portfolio performance and provide AI-generated operational insights. | No stable portfolio metrics or validated prediction use case exists. | Portfolio data quality and a measurable decision workflow are proven. | Organizations, metrics, Audit, AI Gateway and evaluation. | Future | RADAR | Portfolio intelligence direction, 2026-08-19 |
| IR-017 | Integrate or migrate family external apps | Bring existing family applications under Green Hive governance. | Each app requires a separate inventory, owner decision and migration plan. | An application owner approves discovery and a bounded migration slice. | GH-0250 app relationships, connector/migration contract and backups. | P1 | PLANNED | Shared portfolio direction, 2026-08-19 |
| IR-018 | Infrastructure split per app | Allow selected apps to use isolated database or service infrastructure. | Central control-plane and tenant contracts must stabilize first. | Compliance, performance or fault-isolation evidence requires separation. | Organizations, app installations, deployment registry and observability. | P2 | RADAR | Approved central-control-plane direction |
| IR-019 | Break-glass admin access | Audited, time-bound emergency access to private tenant content. | Automatic platform-admin content access is being removed; emergency governance is not defined. | Production support creates a real incident-response requirement. | Audit, approvals, time limits, notification and security review. | P1 | RADAR | Explicitly deferred in GH-0250 |
| IR-020 | Consumer-driven contracts | Sophisticated compatibility testing between platform and many consumers. | There are not enough independently deployed consumers to justify it. | Two or more external consumers release independently. | Public API/package versioning and CI federation. | P2 | RADAR | Shared architecture review, 2026-08-19 |
| IR-021 | CLI and template generator | Generate compliant app manifests, package shells and integration fixtures. | The official contract must be stable before automating it. | A second external app is onboarded and the workflow repeats. | App lifecycle, published packages and official CLI decision. | P1 | RADAR | Shared architecture review, 2026-08-19 |
| IR-022 | Portfolio Dashboard | Aggregate all or selected workspaces and apps with real revenue, cost, infrastructure, API/AI usage, trends, forecasting and evaluated AI insights. | The navigation and `ALL_WORKSPACES` / `SELECTED_WORKSPACES` frontend scope exist, but Billing, usage metering and portfolio data contracts do not. Placeholder metrics would be misleading. | At least two workspaces/apps expose trustworthy comparable usage and financial data through approved contracts. | Organizations, app selection, Billing, Cost Guard, usage metering, Observability, AI Gateway and evaluation. | P1 | PLANNED | Frontend navigation and onboarding review, 2026-08-22 |

## Promotion rule

Promotion requires an explicit decision that records the problem, evidence, owner, dependencies,
security boundary, acceptance tests and backlog checkpoint. Promotion never happens merely because
an idea appears technically attractive.
