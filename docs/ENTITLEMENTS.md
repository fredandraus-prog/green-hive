# Entitlements

## Boundary

Entitlements answers one server-side question:

```text
May this verified user use this capability on this project in this app and workspace?
```

It does not select products, price purchases, collect payment, process provider payloads, account
for usage or reserve cost. Billing remains commercial truth. GH-0304 consumes only Billing states
that have already become authoritative.

## Public TypeScript surface

`@green-hive/entitlements` exports:

- `ProjectEntitlement` and `EntitlementStatus` (`ACTIVE` or `REVOKED`);
- `EntitlementRepository` and `PostgresEntitlementRepository`;
- `EntitlementService.can(context, projectId, capabilityCode)`;
- `EntitlementService.list(context, projectId)` for owner-side operational inspection;
- stable `EntitlementError` codes and runtime validators.

Every operation requires a `TrustedOrganizationContext` built from a verified server session.
Platform administrators cannot reuse owner service commands. Invalid input and storage errors are
converted to stable messages that expose no SQL, stack, token, provider reference or resource
existence outside the authorized scope.

## Product mappings and grant snapshots

`hive.product_entitlement_capabilities` is a reviewed mapping between an app product and capability
codes declared in that app's canonical manifest. The structural seed maps
`REFERENCE_APP_SANDBOX` to:

- `REFERENCE_APP_RUN_JOB`;
- `REFERENCE_APP_GENERATE_FILE`.

The seed verifies the immutable app and product identities, verifies both manifest declarations,
rejects unexpected mappings, is safe to reapply and reconciles already authoritative purchases.

`hive.project_entitlements` stores one snapshot for each `(purchase, capability)` pair. It retains
the project, app, workspace, owner, product, product code, price version, purchase, payment, source,
status and lifecycle timestamps. Composite foreign keys prevent a grant from crossing the source
purchase, payment, project, app, workspace or product mapping.

## Transactional synchronization

`hive.apply_entitlement_state_for_purchase(uuid)` is internal and revoked from `PUBLIC` and
`authenticated`:

- a `CONFIRMED` purchase with a `PAID` payment creates or reactivates its reviewed capability
  snapshots;
- a `CONFIRMED` purchase with a `REFUNDED` payment changes its own snapshots to `REVOKED`;
- pending, failed or canceled commercial states grant nothing;
- exact reprocessing makes no duplicate snapshot or Audit effect.

Payment and purchase transition triggers invoke the function in the same transaction as the
authoritative Billing change. One refunded purchase cannot revoke another purchase's rows. The
`can()` decision therefore stays true while at least one active grant exists for that
project/capability.

## Server-authoritative decision

`hive.can_project_capability(project_id, capability_code)` requires all of the following:

```text
auth.uid() is present
AND platform_role is not PLATFORM_ADMIN
AND app_metadata.app_code resolves to the project's app
AND the selected organization is an active trusted membership/app installation
AND the project belongs to the user, app and organization
AND the project is DRAFT or ACTIVE
AND an ACTIVE grant exists for the capability
AND the product-to-capability mapping is active
AND the capability remains declared by the stored canonical App Manifest
```

`user_metadata`, browser payloads, arbitrary headers, query strings, environment variables,
product names and payment claims are not authorization sources. Capability codes must use the
current app namespace. Unknown but well-formed capabilities return `false`; malformed inputs fail
with `INVALID_ENTITLEMENT_INPUT`.

The Reference App exposes only:

```text
GET /api/projects/{projectId}/capabilities/{capabilityCode}
-> { "allowed": true | false }
```

The protected session and validated workspace cookie supply the context. The endpoint never accepts
owner, app, workspace, purchase, payment or status fields.

## RLS, administration and Audit

- authenticated users can read active mappings for the current app and owner-scoped grant columns;
- authenticated users have no grant-table `INSERT`, `UPDATE` or `DELETE` privilege;
- authenticated users can execute `can()` but not the synchronization function;
- platform administrators can inspect operational mapping/grant rows through RLS but cannot use
  owner service commands or `can()` as an owner;
- `ENTITLEMENT_GRANTED` records a newly active grant;
- `ENTITLEMENT_CHANGED` records a revocation or reactivation;
- Audit metadata contains only capability code, product code, price version, source and status.

No raw webhook, idempotency key, provider reference, price amount, credentials or consumer-domain
payload enters an Entitlement Audit event.

## Deferred

- manual/internal grants and time-limited grants;
- subscription periods, seats and quantity-based capabilities;
- administrative grant mutation workflows;
- usage accounting and Cost Guard;
- Jobs, AI, Files and real-provider integrations;
- frontend purchase/checkout and capability-management screens.

