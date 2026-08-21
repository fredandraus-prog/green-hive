# 00 — Green Hive Platform Overview

## Mission

Green Hive is the shared technical platform for BeeGreen applications. It centralizes infrastructure that should be solved once and reused: identity, projects, payments, entitlements, cost control, external provider gateways, jobs, private files, trust policies, audit, internationalization, operations and shared UI foundations.

## Platform model

```text
BeeGreen Applications
        │
        ▼
Green Hive App Contract / SDK
        │
        ▼
┌────────────────────────────────────────────┐
│                  GREEN HIVE                │
│ Auth · Accounts · Projects · Billing       │
│ Entitlements · Cost Guard · Jobs · Files   │
│ AI/Search Gateways · Trust · Audit · i18n  │
│ Feature Flags · Admin · Observability      │
└─────────────────────┬──────────────────────┘
                      │
                      ▼
       PostgreSQL / Auth / Storage / SaaS
```

## Architectural style

- TypeScript-centered implementation.
- React + Vite for shared web UI/app shell direction.
- Responsive web and PWA first.
- PostgreSQL / Supabase-oriented backend direction.
- Modular monolith, not microservices.
- One primary relational database initially.
- Server authoritative for permissions, entitlements and derived state.
- External providers are accessed through Green Hive gateways.

## Design goals

1. Allow a new BeeGreen app to reuse platform services without copying infrastructure.
2. Enforce cross-user and cross-project isolation by default.
3. Make variable external costs measurable and bounded.
4. Keep AI/provider choice replaceable.
5. Keep app-specific domain logic outside Green Hive.
6. Make staging, testing and operational diagnosis possible before any public app launch.

## Core principle

Green Hive v1 is **not** a universal platform built for hypothetical future products. It is a reusable core containing the capabilities already required by the first real BeeGreen application, generalized only where the abstraction is already justified.
