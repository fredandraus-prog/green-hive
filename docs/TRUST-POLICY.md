# Trust Policy and data classification

GH-0502 establishes the server-side policy-decision boundary in `@green-hive/trust`. It evaluates
trusted metadata before external processing, search or logging. It never accepts a prompt, document,
payload, secret or arbitrary content value.

## Canonical classifications

| Classification | External-processing default | Meaning |
|---|---|---|
| `PUBLIC` | `ALLOW` | intentionally public information |
| `INTERNAL` | `ALLOW` | low-sensitivity platform metadata |
| `CONFIDENTIAL` | `MINIMIZE` | private user, app or project information |
| `HIGHLY_CONFIDENTIAL` | `DENY_OR_EXPLICIT_POLICY` | exceptionally sensitive data requiring strict policy |

Classification is supplied by trusted server-side app logic. GH-0502 does not infer sensitivity
from text and does not claim automatic PII, secret or document classification.

## Evaluation contract

`TrustPolicyService.evaluate(context, input)` receives:

- a `TrustedAppContext` extracted from a verified session/JWT;
- an optional project identity used only as decision correlation, not authorization;
- `EXTERNAL_PROVIDER`, `SEARCH_QUERY` or `LOG`;
- one canonical classification;
- the server-selected provider for provider/search operations;
- an optional trusted confidential-mode capability flag.

It returns one of:

| Decision | Required action | Meaning |
|---|---|---|
| `ALLOW` | `PROCESS` | the policy permits the operation, subject to authorization/entitlement/cost gates |
| `ALLOW_WITH_SANITIZATION` | `SANITIZE` | app/Gateway must apply the named semantic sanitizer first |
| `REQUIRE_CONFIRMATION` | `CONFIRM` | processing remains blocked until a separate verified confirmation workflow succeeds |
| `DENY` | `BLOCK` | processing must not continue |

Sanitization modes are `MINIMIZE_CONTEXT`, `ABSTRACT_QUERY` and `METADATA_ONLY`. They are mandatory
actions, not a claim that Green Hive can generically understand and rewrite application content.
Semantic sanitizers remain app/Gateway hooks, preserving the platform boundary.

## Canonical matrix

The eight policies in the specification are compiled as immutable defaults. Every combination not
present in that matrix returns `TRUST_DEFAULT_DENY` with `POLICY_NOT_CONFIGURED`; omission never
silently inherits a broader allow.

Controlled overrides are versioned and provider-specific. They cannot replace a global default or
reuse a canonical policy identity. For `HIGHLY_CONFIDENTIAL` data, an override can only deny or
require confirmation; confirmation requires an exact provider and `confidentialMode = true`.
Confidential mode alone never relaxes the default decision.

## Security and ownership boundary

- browser headers, query parameters, forms and payload fields are not trusted context;
- raw prompts and data are rejected as unknown evaluation fields;
- `PLATFORM_ADMIN` cannot reuse the owner path to gain content processing authority;
- decisions omit actor, app and workspace identities;
- project authorization, entitlement and Cost Guard remain separate mandatory gates;
- provider selection remains owned by future server-side routing;
- policy configuration contains no provider secret.

GH-0502 creates no database object, RLS policy, HTTP endpoint, UI, automatic classifier,
confirmation persistence or external-provider integration. Trust enforcement inside the AI Gateway
begins in GH-0503.
