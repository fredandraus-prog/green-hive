# Shared UI primitives

GH-0702 makes `@green-hive/ui` the home for small, accessible React primitives that do not know a
product, route, API, session, tenant or authorization model.

## Current primitives

- `Field`: native labeled input with an optional hint;
- `SelectField`: native labeled select with an optional hint;
- `Message`: error messages announce with `role="alert"`; success and information use `role="status"`;
- `LoadingPanel`: exposes a polite loading status and keeps its decorative spinner hidden from
  assistive technology.

The package supplies semantics and stable class names only. Application CSS continues to own visual
tokens. The Reference App retains navigation, URL changes, translations, dialogs, focus control,
workspace selection and all business behavior locally. This boundary prevents a shared visual layer
from becoming an authorization or application-runtime dependency.

No design-system server, external component framework, telemetry, remote theme configuration or
browser storage is introduced by this checkpoint.
