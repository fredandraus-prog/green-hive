# 03 — Green Hive App Contract

## Purpose

The App Contract defines the minimum interface between Green Hive and any BeeGreen application. A new app should integrate by declaring its needs rather than copying Green Hive code.

## App Manifest

Each application registers a manifest with stable identifiers.

Conceptual shape:

```text
app_code
app_name
app_version
status
supported_locales
required_hive_capabilities
product_codes
entitlement_capability_prefix
registered_job_types
registered_ai_task_types
feature_flag_prefix
application_routes
schema_namespace
```

The normative field list is in `data/app_manifest_fields.csv`.

## Stable app code

`app_code` is immutable after production launch. Display names may change; technical identity must not.

Example first consumer:

```text
app_code = BEESNESS
```

This example does not make Beesness logic part of Green Hive.

## Capability declaration

Applications explicitly declare which Green Hive capabilities they require, e.g.:

```text
AUTH
PROJECTS
BILLING
ENTITLEMENTS
AI
JOBS
FILES
AUDIT
I18N
```

Search or user uploads need not be enabled merely because Green Hive has a contract for them.

## Registration contracts

An app can register:

- products/prices supplied to Billing;
- entitlement capability codes;
- job type codes and their handler ownership;
- AI task type codes and response schemas;
- application-specific feature flag codes;
- locale bundles;
- app-specific routes and shell metadata.

## Naming

App-owned codes should use the app prefix:

```text
BEESNESS_RUN_ANALYSIS
BEESNESS_GENERATE_REPORT
```

Green Hive core capability codes use `HIVE_` or a platform-reserved namespace.

## Acceptance criteria

A second fake app must be registrable without modifying Green Hive domain code. Only manifest/configuration and app-owned implementation should be required.
