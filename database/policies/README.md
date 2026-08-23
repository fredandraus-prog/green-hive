# RLS policies

The effective authorization boundary is the verified user, selected organization and signed app
claim. Organization selection is accepted only after active membership is checked inside the same
database transaction.

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
