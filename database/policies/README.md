# RLS policies

The effective authorization boundary is the verified user, selected organization and signed app
claim. Organization selection is accepted only after active membership is checked inside the same
database transaction. The current schema has twenty-five RLS-protected tables, including
`audit.events`.

| Table | Tenant user | Platform admin | Physical delete |
|---|---|---|---|
| `hive.apps` | no direct visibility | read global app definitions | denied |
| `hive.user_profiles` | read/create/update own profile | denied private profile content | denied |
| `hive.organizations` | read selected active membership; role-limited administration | read safe operational metadata | denied |
| `hive.organization_members` | read selected membership; role-limited administration | read safe operational metadata | denied |
| `hive.organization_apps` | read selected installation; role-limited administration | read safe operational metadata | denied |
| `hive.organization_app_members` | read selected app membership; role-limited administration | read safe operational metadata | denied |
| `hive.projects` | owner-only read/create/update in selected organization and app | denied private project content | denied |
| `hive.project_settings` | owner-only read/create/update through an authorized project | denied private settings content | denied |
| `hive.products` / `hive.prices` | current-app catalog read only | read safe catalog metadata | denied |
| `hive.purchases` / `hive.payments` | owner/project/workspace read only; pending purchase function only | denied private commercial rows | denied |
| `hive.payment_provider_events` | no visibility or direct writes | no policy; controlled server operations only | denied |
| `hive.search_operations` | read own safe metadata in the selected organization/app/project; no direct writes | read safe cross-tenant operation metadata; no writes | denied |
| `audit.events` | read selected organization/app events; no direct writes | read safe operational audit metadata; no writes | denied |

Project deletion is logical and uses `hive.soft_delete_project(uuid)`. The function validates
`auth.uid()`, the signed app claim, the transaction-scoped organization and current ownership before
setting `DELETED`/`deleted_at`. The row is then hidden from ordinary owner queries and remains
retained for controlled operations and audit evidence. Platform administration does not create an
implicit path to private project content.

Audit records are appended only by narrowly scoped database trigger functions in the same
transaction as the protected lifecycle change. The `authenticated` role has no `INSERT`, `UPDATE`
or `DELETE` grant or policy on `audit.events`.

Authenticated users cannot execute the GH-0302 payment-result/refund functions. Those functions
are server-only and repeat user/app/workspace checks before applying an idempotent transition.
The GH-0303 verified-webhook function and provider-event table are also revoked from
`authenticated`. Forced RLS has no client policy on the event table, and raw payloads/signatures
are not persisted.

GH-0505 forces RLS on `hive.search_operations`. The `authenticated` role receives only selected
metadata columns and cannot read `request_fingerprint_sha256`; it has no `INSERT`, `UPDATE` or
`DELETE` privilege and cannot execute the lifecycle functions. Only `service_role` may call
`hive.start_search_operation`, `hive.complete_search_operation_accounted` and
the accounted or unreserved failure writers; the lower-level `hive.complete_search_operation`
helper remains private. The writers revalidate trusted user, organization, app and project
ownership. Accounted completion locks and verifies the matching Cost Guard reservation, consumes
it, records retry-aware Search usage and marks the operation successful atomically. Accounted
failure through `hive.fail_search_operation_accounted(text, uuid, text)` releases the reservation
and records `FAILED` plus its Audit transition atomically. Both accounted functions require exact
equality between reservation and operation estimates. The simple `hive.fail_search_operation`
function rejects any operation with a reservation. Platform administration remains read-only.

Only terminal Search transitions generate `SEARCH_OPERATION_COMPLETED` or
`SEARCH_OPERATION_FAILED`. Audit metadata is limited to search type, state, provider, result and
request counts, cache status and a safe error code. Query text, URLs, snippets and result content
are prohibited from both the operation table and its Audit event.
