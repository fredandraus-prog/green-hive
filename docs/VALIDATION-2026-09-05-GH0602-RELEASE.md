# GH-0602 release validation — 2026-09-05

## Scope and release identity

This evidence closes GH-0602 Signed Private-File Download Path for coordinated platform version
`0.24.0`. The `REFERENCE_APP` product manifest remains `0.1.0`.

```text
implementation PR:       #37
implementation merge:    5a67d8a357d1ef5afdd4eb15ff821cdec64cb8a0
operational-parity PR:   #38
operational-parity merge: 9c4db1d529812c32d44757c7799c6fe62591c70e
main CI run:             33959814343 (success)
staging project:         green-hive-staging (dedicated Supabase project)
```

PRs: <https://github.com/fredandraus-prog/green-hive/pull/37> and
<https://github.com/fredandraus-prog/green-hive/pull/38>

## Verified gates

- Pull-request CI and the merged-main CI run `33959814343` completed successfully.
- Local final validation passed: 168 unit tests, 23 embedded database scenarios, `db:validate`
  with 24 immutable migrations and 26 RLS-protected tables, production build, security smoke and
  `npm audit --audit-level=high --omit=dev` with zero reported vulnerabilities.
- The guarded local Storage probe passed with the real server-only Supabase adapter. It writes one
  random opaque object, proves its public object URL is rejected, reads it through a 120-second
  `FileService` signed grant and removes it in `finally`.
- Dedicated staging preflight found exactly 23 applied migrations, one pending migration and zero
  disposable users, profiles, projects, settings or apps. The apply gate installed only
  `0024_create_private_file_downloads.sql`, replayed structural seeds, then confirmed ledger `24`
  and `REFERENCE_APP=1`, without deleting a schema or user.
- The guarded staging Storage probe passed in 3.5 seconds using the same private-write,
  public-denial, signed-read and cleanup sequence. It did not print a signed URL or credential.
- The native staging RLS suite passed the core RLS/Audit, Project/Workspace, Billing, Entitlements,
  Usage/Cost, Cost Guard, Jobs, Worker and AI matrices after `0024` was installed.

Migration `0024` is recorded with SHA-256
`2e25bc06129ffd5e083fcfe8f8fb87e056402583a9450e9f7c931d5f31148c45`.

## Published-service boundary

GH-0602 deliberately provides no browser upload, public Storage URL or client Storage authority;
the deployed Reference App does not yet compose File Service. A public Render liveness/readiness
probe was attempted after main CI but did not respond within the 15-second application gate or a
single 60-second wake-up read. This evidence therefore does **not** assert a new hosted smoke
result. That transient host response does not invalidate the independently verified private Storage
and dedicated Supabase staging gates, and it does not expand the published surface.

## Distribution handoff

The release branch regenerates and verifies the source SHA-256 manifest. The source-only archive
is extracted into a temporary directory, installed cleanly and verified before the `v0.24.0` tag is
created. The final artifact name and checksum are recorded after those operations are observed.
