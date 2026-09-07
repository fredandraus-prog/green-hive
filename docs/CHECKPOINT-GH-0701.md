# GH-0701 — Locale, language and formatting core

## Result

`@green-hive/i18n` now provides an immutable supported-locale registry, safe locale resolution,
typed message lookup and safe `Intl` date/time formatting. The Reference App consumes that package
through one React provider. Its navigation, project workflow, loading state, core account controls
and product entry actions react to the persisted language preference.

## Security and boundaries

Locale is presentation state only. It is not read from a request header, query string, form field or
browser storage to establish authorization. The authenticated app adopts the locale only after
loading the profile through the existing cookie-protected `/api/me` route; profile writes keep using
the existing server validation. App/workspace/user identity and all RLS decisions remain unchanged.

No migration is needed. The existing profile fields are sufficient. There is no external translator,
translation-provider credential, network request, remote configuration, or change to Billing, AI,
Jobs, Redis, webhooks or Storage.

## Acceptance checks

- `pt-BR` and `en-US` are the only selectable Reference App locales; a malformed/unsupported value
  falls back to `pt-BR`.
- browser-language resolution works before sign-in; persisted profile locale wins after sign-in;
  saving Profile updates the current interface in the same session.
- project labels, actions, empty states, status and dates use the selected locale.
- unit tests cover locale fallback, interpolation, deterministic timezone formatting and source-level
  Reference App wiring, alongside the existing platform suite.
