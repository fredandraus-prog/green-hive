# Platform Boundaries

## Green Hive owns

- app registration and application identity;
- authentication/account integration contracts;
- projects and app/project isolation;
- billing, products, prices and payment abstractions;
- entitlements;
- Cost Guard, usage and provider cost accounting;
- jobs/workers;
- AI and Search gateway infrastructure;
- Trust Policy and data classification;
- private files and generic rendering infrastructure;
- audit, observability and notifications;
- i18n/locale infrastructure;
- feature flags;
- shared accessible UI primitives;
- operational admin and developer integration contracts.

## Green Hive does not own

- business-plan concepts;
- business viability rules;
- break-even formulas for a product domain;
- sector-specific questions;
- product-domain risk engines;
- product-domain documents or prompts;
- any Beesness business rule.

## Dependency rule

Applications may depend on public Green Hive packages. Green Hive packages must not depend on application-domain code.

## V1 constraint

Green Hive v1 contains only abstractions required to support a real first application. Speculative enterprise capabilities remain out of scope until a consumer proves the need.
