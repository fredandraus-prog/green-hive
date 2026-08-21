# Green Hive App Contract v1

Every Green Hive application registers through a validated `AppManifestV1`.

The manifest is a platform contract, not a storage dump. It describes what the application is, what shared capabilities it needs, and the platform-level identifiers it owns.

## Required identity

- `schemaVersion`
- `appCode`
- `appName`
- `appVersion`
- `status`
- `projectNamespace`
- `supportedLocales`
- `defaultLocale`

## Registrations

An application may register:

- required Green Hive capabilities;
- product codes;
- entitlement capability codes;
- job type codes;
- AI task type codes;
- feature flag codes;
- application route metadata.

## Stable identifiers

Application codes and registered codes are uppercase ASCII identifiers using underscores. Once used in production, a code must not be silently repurposed for a different meaning.

Examples:

```text
REFERENCE_APP
BEESNESS
REFERENCE_APP_RUN_JOB
BEESNESS_RUN_ANALYSIS
```

## Validation requirements

The Green Hive registry rejects manifests that have:

- invalid codes;
- invalid semantic versions;
- duplicate locales or registrations;
- unsupported Green Hive capabilities;
- default locale outside `supportedLocales`;
- duplicate `appCode` registration;
- product/job/AI/feature codes outside the application's namespace unless explicitly platform-owned.

## App isolation

`appCode`/`app_id` is part of project identity. A consumer application must not obtain projects from another application merely because the same user owns them.
