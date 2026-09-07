# GH-0702 — Shared accessible UI primitives

`@green-hive/ui` now exports the first reusable accessible primitives and the Reference App consumes
them for form controls, feedback and loading. Tests assert native field/select semantics, labels,
hints, status roles and the Reference App's use of the package.

This is intentionally a narrow visual foundation. Domain-specific workspace selection and modal
behavior remain in the Reference App, preserving its keyboard, focus and navigation logic. There
are no database changes, network calls, policy decisions, authorization inputs, feature flags,
remote UI configuration or third-party UI packages.
