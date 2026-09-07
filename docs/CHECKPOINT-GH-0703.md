# GH-0703 — Feature Flags Foundation

## Delivered

- Manifest-backed, namespaced registry in `@green-hive/feature-flags`.
- Deterministic `OFF`, `INTERNAL`, `BETA` and `PUBLIC` evaluation with typed
  decision reasons.
- App mismatch denial, explicit user/workspace beta audiences and an `OFF` kill
  switch that wins over every audience rule.
- Platform-admin-only, read-only configuration hook.
- Unit coverage for rollout states, cross-app denial, unregistered code denial,
  malformed configuration and administrative visibility.

## Deliberate boundaries

- No persistent flag mutation, database migration, remote configuration, cache,
  client evaluation, analytics exposure or administrative screen.
- No flag changes authorization, RLS policy, application identity, workspace
  selection, billing, AI, jobs, files or external-provider behavior.
- The feature-flag contract has no network, browser, secret or paid dependency.

## Acceptance evidence

`npm run verify --silent` covers the new unit matrix in addition to the existing
repository gates. The `OFF` branch is covered as the kill-switch acceptance case.
