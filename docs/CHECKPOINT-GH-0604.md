# GH-0604 — Basic in-app notifications

GH-0604 adds the smallest useful notification path: a completed background job creates one durable
in-app notification for the affected project owner, and that owner can view and acknowledge it in
the Reference App.

## Included

- immutable migration `0026_create_in_app_notifications.sql` and SHA-256 ledger entry;
- `hive.notifications`, with composite project/job scope, one notification per completed job and
  constrained `UNREAD` → `READ` acknowledgement;
- a trusted trigger activated only when `hive.jobs.status` first becomes `COMPLETED`;
- forced RLS: owner reads and marks only their own app/workspace notifications as read; platform
  admins may inspect but cannot create, alter or delete notifications;
- typed `@green-hive/notifications` contracts, runtime validation, PostgreSQL repository and safe
  public errors;
- protected Reference App endpoints (`GET /api/notifications`,
  `POST /api/notifications/:id/read`) plus an accessible workspace Notifications view.

## Security boundary

The browser supplies neither recipient, job, project, app, workspace nor event body. The database
derives all notification identity from the completed job row. Notification metadata contains only
the registered job type: it never retains job input, lease token, output reference, file key,
storage credential or rendered document bytes.

No email, push provider, polling daemon, broker, public realtime channel or paid integration is
introduced. A future delivery channel must consume this already-scoped in-app record rather than
become a second notification authority.

## Validation status

Status: `DONE — CLEAN, EMBEDDED, NATIVE SUPABASE AND DEPLOYED HTTPS GATES PASS`.

The embedded PostgreSQL-compatible matrix verifies automatic creation, one notification per job,
owner acknowledgement idempotency, cross-user invisibility and read-only platform-admin access.
The dedicated native Supabase worker/notification matrix repeats that proof using the real
`auth.users`, `auth.uid()` and `auth.jwt()` contract. The deployed HTTPS smoke verifies liveness,
database readiness, HSTS/security headers and the Reference App shell at the published staging
origin.
