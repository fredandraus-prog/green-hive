import assert from 'node:assert/strict';

export const REFERENCE_APP_ID = '00000000-0000-4000-8000-000000000001';
export const OTHER_APP_ID = '00000000-0000-4000-8000-000000000002';
export const USER_A_ID = '10000000-0000-4000-8000-000000000001';
export const USER_B_ID = '10000000-0000-4000-8000-000000000002';
export const ADMIN_ID = '10000000-0000-4000-8000-000000000003';
export const ORGANIZATION_A_ID = '30000000-0000-4000-8000-000000000001';
export const ORGANIZATION_B_ID = '30000000-0000-4000-8000-000000000002';
export const SHARED_ORGANIZATION_ID = '30000000-0000-4000-8000-000000000003';
export const PROJECT_ID = '20000000-0000-4000-8000-000000000001';
export const SECOND_PROJECT_ID = '20000000-0000-4000-8000-000000000002';
export const REFERENCE_PRODUCT_ID = '40000000-0000-4000-8000-000000000001';
export const REFERENCE_PRICE_ID = '50000000-0000-4000-8000-000000000001';

function claims(subject, appCode, platformRole = 'USER', additions = {}) {
  return JSON.stringify({
    sub: subject,
    app_metadata: { app_code: appCode, platform_role: platformRole },
    ...additions,
  });
}

async function setContext(
  query,
  subject,
  appCode,
  organizationId,
  platformRole = 'USER',
  additions = {},
) {
  await query(
    `SELECT
       set_config('request.jwt.claims', $1, false),
       set_config('request.green_hive.organization_id', $2, false)`,
    [claims(subject, appCode, platformRole, additions), organizationId ?? ''],
  );
}

export async function runRlsMatrix(query, testContext) {
  await testContext.test('owner can create, read and update in the selected organization and app', async () => {
    await setContext(query, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    const trusted = await query(
      `SELECT
         hive.current_organization_id()::text AS organization_id,
         hive.has_trusted_organization_context() AS trusted`,
    );
    assert.deepEqual(trusted.rows[0], { organization_id: ORGANIZATION_A_ID, trusted: true });

    const inserted = await query(
      `INSERT INTO hive.projects (id, organization_id, app_id, owner_user_id, name)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Project A')
       RETURNING id, status`,
      [PROJECT_ID, ORGANIZATION_A_ID, REFERENCE_APP_ID, USER_A_ID],
    );
    assert.equal(inserted.rows.length, 1);
    assert.equal(inserted.rows[0].status, 'DRAFT');

    const settings = await query(
      `INSERT INTO hive.project_settings (project_id, organization_id, app_id, country, currency)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'BR', 'BRL')
       RETURNING project_id`,
      [PROJECT_ID, ORGANIZATION_A_ID, REFERENCE_APP_ID],
    );
    assert.equal(settings.rows.length, 1);

    const selected = await query('SELECT id FROM hive.projects WHERE id = $1::uuid', [PROJECT_ID]);
    assert.equal(selected.rows.length, 1);
    const updated = await query(
      "UPDATE hive.projects SET name = 'Project A updated' WHERE id = $1::uuid RETURNING id",
      [PROJECT_ID],
    );
    assert.equal(updated.rows.length, 1);

    const auditEvents = await query(
      `SELECT event_code, metadata
       FROM audit.events
       WHERE project_id = $1::uuid
       ORDER BY occurred_at, id`,
      [PROJECT_ID],
    );
    assert.deepEqual(auditEvents.rows, [
      { event_code: 'PROJECT_CREATED', metadata: { status: 'DRAFT' } },
    ]);
    assert.doesNotMatch(JSON.stringify(auditEvents.rows), /Project A|updated|password|token|secret/i);
    await assert.rejects(
      () => query(
        `INSERT INTO audit.events (
           event_code, actor_user_id, actor_type, organization_id, app_id,
           subject_type, subject_id, request_id, correlation_id
         ) VALUES (
           'PROJECT_CREATED', $1::uuid, 'USER', $2::uuid, $3::uuid,
           'PROJECT', $4::uuid, gen_random_uuid(), gen_random_uuid()
         )`,
        [USER_A_ID, ORGANIZATION_A_ID, REFERENCE_APP_ID, PROJECT_ID],
      ),
      /permission denied|privilege/i,
    );

    const visibleOrganizations = await query('SELECT id::text AS id FROM hive.organizations ORDER BY id');
    assert.deepEqual(
      visibleOrganizations.rows.map((row) => row.id),
      [ORGANIZATION_A_ID, SHARED_ORGANIZATION_ID],
    );
  });

  await testContext.test('cross-user and forged ownership are denied', async () => {
    await setContext(query, USER_B_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    const untrusted = await query('SELECT hive.current_organization_id()::text AS id');
    assert.equal(untrusted.rows[0].id, null);
    const selected = await query('SELECT id FROM hive.projects WHERE id = $1::uuid', [PROJECT_ID]);
    assert.equal(selected.rows.length, 0);
    const auditEvents = await query('SELECT id FROM audit.events WHERE project_id = $1::uuid', [PROJECT_ID]);
    assert.equal(auditEvents.rows.length, 0);

    await setContext(query, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    await assert.rejects(
      () => query(
        `INSERT INTO hive.projects (organization_id, app_id, owner_user_id, name)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'Forged owner')`,
        [ORGANIZATION_A_ID, REFERENCE_APP_ID, USER_B_ID],
      ),
      /row-level security|policy|foreign key/i,
    );
  });

  await testContext.test('same user cannot cross organization or app boundaries', async () => {
    await setContext(query, USER_A_ID, 'REFERENCE_APP', SHARED_ORGANIZATION_ID);
    const crossOrganization = await query('SELECT id FROM hive.projects WHERE id = $1::uuid', [PROJECT_ID]);
    assert.equal(crossOrganization.rows.length, 0);
    const crossOrganizationAudit = await query('SELECT id FROM audit.events WHERE project_id = $1::uuid', [PROJECT_ID]);
    assert.equal(crossOrganizationAudit.rows.length, 0);

    await setContext(query, USER_A_ID, 'OTHER_TEST_APP', ORGANIZATION_A_ID);
    const crossApp = await query('SELECT id FROM hive.projects WHERE id = $1::uuid', [PROJECT_ID]);
    assert.equal(crossApp.rows.length, 0);
    const settings = await query('SELECT project_id FROM hive.project_settings WHERE project_id = $1::uuid', [PROJECT_ID]);
    assert.equal(settings.rows.length, 0);
    const crossAppAudit = await query('SELECT id FROM audit.events WHERE project_id = $1::uuid', [PROJECT_ID]);
    assert.equal(crossAppAudit.rows.length, 0);
  });

  await testContext.test('payload organization, app and owner ids cannot override trusted context', async () => {
    await setContext(query, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    await assert.rejects(
      () => query(
        `INSERT INTO hive.projects (organization_id, app_id, owner_user_id, name)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'Forged organization')`,
        [SHARED_ORGANIZATION_ID, REFERENCE_APP_ID, USER_A_ID],
      ),
      /row-level security|policy/i,
    );
    await assert.rejects(
      () => query(
        `INSERT INTO hive.projects (organization_id, app_id, owner_user_id, name)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'Forged app')`,
        [ORGANIZATION_A_ID, OTHER_APP_ID, USER_A_ID],
      ),
      /row-level security|policy/i,
    );
  });

  await testContext.test('catalog and pending purchase creation are trusted, atomic and idempotent', async () => {
    await setContext(query, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    const catalog = await query(
      `SELECT
         product.product_code,
         product.product_type,
         price.amount::text AS amount,
         price.currency,
         price.version
       FROM hive.products AS product
       JOIN hive.prices AS price ON price.product_id = product.id
       ORDER BY product.product_code, price.version`,
    );
    assert.deepEqual(catalog.rows, [
      {
        product_code: 'REFERENCE_APP_SANDBOX',
        product_type: 'ONE_TIME',
        amount: '0.000000',
        currency: 'BRL',
        version: 1,
      },
    ]);

    const created = await query(
      `SELECT hive.create_pending_purchase($1::uuid, $2, $3::uuid, $4)::text AS id`,
      [PROJECT_ID, 'REFERENCE_APP_SANDBOX', REFERENCE_PRICE_ID, 'rls-purchase-0001'],
    );
    const repeated = await query(
      `SELECT hive.create_pending_purchase($1::uuid, $2, $3::uuid, $4)::text AS id`,
      [PROJECT_ID, 'REFERENCE_APP_SANDBOX', REFERENCE_PRICE_ID, 'rls-purchase-0001'],
    );
    assert.equal(repeated.rows[0].id, created.rows[0].id);

    const purchases = await query(
      `SELECT
         id::text AS id,
         product_code,
         price_version,
         amount::text AS amount,
         currency,
         status
       FROM hive.purchases
       WHERE project_id = $1::uuid`,
      [PROJECT_ID],
    );
    assert.deepEqual(purchases.rows, [
      {
        id: created.rows[0].id,
        product_code: 'REFERENCE_APP_SANDBOX',
        price_version: 1,
        amount: '0.000000',
        currency: 'BRL',
        status: 'PENDING',
      },
    ]);
    const payments = await query(
      `SELECT purchase_id::text AS purchase_id, attempt_number, amount::text AS amount, currency, status
       FROM hive.payments
       WHERE purchase_id = $1::uuid`,
      [created.rows[0].id],
    );
    assert.deepEqual(payments.rows, [
      {
        purchase_id: created.rows[0].id,
        attempt_number: 1,
        amount: '0.000000',
        currency: 'BRL',
        status: 'PENDING',
      },
    ]);
    const billingAudit = await query(
      `SELECT event_code, metadata
       FROM audit.events
       WHERE subject_type = 'PURCHASE' AND subject_id = $1::uuid`,
      [created.rows[0].id],
    );
    assert.deepEqual(billingAudit.rows, [
      {
        event_code: 'PURCHASE_CREATED',
        metadata: {
          product_code: 'REFERENCE_APP_SANDBOX',
          price_version: 1,
          status: 'PENDING',
        },
      },
    ]);
    assert.doesNotMatch(JSON.stringify(billingAudit.rows), /idempotency|token|secret|provider/i);

    await assert.rejects(
      () => query(
        `INSERT INTO hive.purchases (
           organization_id, app_id, project_id, owner_user_id,
           product_id, price_id, product_code, price_version,
           amount, currency, idempotency_key_sha256
         ) VALUES (
           $1::uuid, $2::uuid, $3::uuid, $4::uuid,
           $5::uuid, $6::uuid, 'REFERENCE_APP_SANDBOX', 1,
           999999.00, 'USD', repeat('0', 64)
         )`,
        [ORGANIZATION_A_ID, REFERENCE_APP_ID, PROJECT_ID, USER_A_ID, REFERENCE_PRODUCT_ID, REFERENCE_PRICE_ID],
      ),
      /permission denied|privilege/i,
    );
    await assert.rejects(
      () => query('SELECT idempotency_key_sha256 FROM hive.purchases'),
      /permission denied|privilege/i,
    );
    await assert.rejects(
      () => query('SELECT provider_payment_id FROM hive.payments'),
      /permission denied|privilege/i,
    );

    const secondProject = await query(
      `INSERT INTO hive.projects (id, organization_id, app_id, owner_user_id, name)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Second Project A')
       RETURNING id`,
      [SECOND_PROJECT_ID, ORGANIZATION_A_ID, REFERENCE_APP_ID, USER_A_ID],
    );
    assert.equal(secondProject.rows.length, 1);
    await assert.rejects(
      () => query(
        `SELECT hive.create_pending_purchase($1::uuid, $2, $3::uuid, $4)`,
        [SECOND_PROJECT_ID, 'REFERENCE_APP_SANDBOX', REFERENCE_PRICE_ID, 'rls-purchase-0001'],
      ),
      /BILLING_IDEMPOTENCY_CONFLICT/i,
    );
  });

  await testContext.test('billing rows do not cross user, organization or app boundaries', async () => {
    await setContext(query, USER_B_ID, 'REFERENCE_APP', ORGANIZATION_B_ID);
    assert.equal((await query('SELECT id FROM hive.purchases')).rows.length, 0);
    assert.equal((await query('SELECT id FROM hive.payments')).rows.length, 0);
    await assert.rejects(
      () => query(
        `SELECT hive.create_pending_purchase($1::uuid, $2, $3::uuid, $4)`,
        [PROJECT_ID, 'REFERENCE_APP_SANDBOX', REFERENCE_PRICE_ID, 'rls-purchase-cross-user'],
      ),
      /BILLING_ACCESS_DENIED/i,
    );

    await setContext(query, USER_A_ID, 'REFERENCE_APP', SHARED_ORGANIZATION_ID);
    assert.equal((await query('SELECT id FROM hive.purchases')).rows.length, 0);
    assert.equal((await query('SELECT id FROM hive.payments')).rows.length, 0);

    await setContext(query, USER_A_ID, 'OTHER_TEST_APP', ORGANIZATION_A_ID);
    assert.equal((await query('SELECT id FROM hive.products')).rows.length, 0);
    assert.equal((await query('SELECT id FROM hive.purchases')).rows.length, 0);
    assert.equal((await query('SELECT id FROM hive.payments')).rows.length, 0);
  });

  await testContext.test('user_metadata cannot grant platform administration', async () => {
    await setContext(query, USER_B_ID, 'REFERENCE_APP', ORGANIZATION_B_ID, 'USER', {
      user_metadata: { platform_role: 'PLATFORM_ADMIN', app_code: 'REFERENCE_APP' },
      platform_role: 'PLATFORM_ADMIN',
    });
    const projects = await query('SELECT id FROM hive.projects WHERE id = $1::uuid', [PROJECT_ID]);
    assert.equal(projects.rows.length, 0);
    const apps = await query('SELECT id FROM hive.apps');
    assert.equal(apps.rows.length, 0);
  });

  await testContext.test('platform admin sees operational metadata but not private content', async () => {
    await setContext(query, ADMIN_ID, 'REFERENCE_APP', null, 'PLATFORM_ADMIN');
    const projects = await query('SELECT id FROM hive.projects WHERE id = $1::uuid', [PROJECT_ID]);
    assert.equal(projects.rows.length, 0);
    const settings = await query('SELECT project_id FROM hive.project_settings WHERE project_id = $1::uuid', [PROJECT_ID]);
    assert.equal(settings.rows.length, 0);
    const profiles = await query('SELECT user_id::text AS user_id FROM hive.user_profiles ORDER BY user_id');
    assert.deepEqual(profiles.rows.map((row) => row.user_id), [ADMIN_ID]);

    const apps = await query('SELECT app_code FROM hive.apps ORDER BY app_code');
    assert.deepEqual(apps.rows.map((row) => row.app_code), ['OTHER_TEST_APP', 'REFERENCE_APP']);
    const organizations = await query('SELECT id FROM hive.organizations ORDER BY id');
    assert.equal(organizations.rows.length, 3);
    const catalog = await query('SELECT product_code FROM hive.products ORDER BY product_code');
    assert.deepEqual(catalog.rows, [{ product_code: 'REFERENCE_APP_SANDBOX' }]);
    assert.equal((await query('SELECT id FROM hive.purchases')).rows.length, 0);
    assert.equal((await query('SELECT id FROM hive.payments')).rows.length, 0);
    await assert.rejects(
      () => query(
        `SELECT hive.create_pending_purchase($1::uuid, $2, $3::uuid, $4)`,
        [PROJECT_ID, 'REFERENCE_APP_SANDBOX', REFERENCE_PRICE_ID, 'rls-purchase-admin'],
      ),
      /BILLING_ACCESS_DENIED/i,
    );
    const auditEvents = await query(
      'SELECT event_code, metadata FROM audit.events WHERE project_id = $1::uuid ORDER BY occurred_at, id',
      [PROJECT_ID],
    );
    assert.deepEqual(auditEvents.rows, [
      { event_code: 'PROJECT_CREATED', metadata: { status: 'DRAFT' } },
      {
        event_code: 'PURCHASE_CREATED',
        metadata: {
          product_code: 'REFERENCE_APP_SANDBOX',
          price_version: 1,
          status: 'PENDING',
        },
      },
    ]);
    assert.doesNotMatch(JSON.stringify(auditEvents.rows), /Project A|updated|password|token|secret/i);
    const updated = await query("UPDATE hive.organizations SET name = 'Forbidden admin write' RETURNING id");
    assert.equal(updated.rows.length, 0);
  });

  await testContext.test('owner soft-deletes while private retention stays hidden from admin', async () => {
    await setContext(query, USER_A_ID, 'REFERENCE_APP', ORGANIZATION_A_ID);
    const softDeleted = await query('SELECT hive.soft_delete_project($1::uuid) AS deleted', [PROJECT_ID]);
    assert.equal(softDeleted.rows[0].deleted, true);

    const ownerProject = await query('SELECT id FROM hive.projects WHERE id = $1::uuid', [PROJECT_ID]);
    assert.equal(ownerProject.rows.length, 0);
    const ownerSettings = await query('SELECT project_id FROM hive.project_settings WHERE project_id = $1::uuid', [PROJECT_ID]);
    assert.equal(ownerSettings.rows.length, 0);
    const retainedAudit = await query(
      'SELECT event_code FROM audit.events WHERE project_id = $1::uuid ORDER BY occurred_at, id',
      [PROJECT_ID],
    );
    assert.deepEqual(retainedAudit.rows.map((row) => row.event_code), [
      'PROJECT_CREATED',
      'PURCHASE_CREATED',
      'PROJECT_DELETION_REQUESTED',
    ]);
    await assert.rejects(
      () => query("UPDATE audit.events SET outcome = 'FAILED' WHERE project_id = $1::uuid", [PROJECT_ID]),
      /permission denied|privilege/i,
    );
    await assert.rejects(
      () => query('DELETE FROM audit.events WHERE project_id = $1::uuid', [PROJECT_ID]),
      /permission denied|privilege/i,
    );
    await assert.rejects(
      () => query('DELETE FROM hive.projects WHERE id = $1::uuid', [PROJECT_ID]),
      /permission denied|privilege/i,
    );

    await setContext(query, ADMIN_ID, 'REFERENCE_APP', null, 'PLATFORM_ADMIN');
    const hiddenFromAdmin = await query('SELECT id FROM hive.projects WHERE id = $1::uuid', [PROJECT_ID]);
    assert.equal(hiddenFromAdmin.rows.length, 0);

    await query('RESET ROLE');
    const retainedProject = await query('SELECT status, deleted_at FROM hive.projects WHERE id = $1::uuid', [PROJECT_ID]);
    assert.equal(retainedProject.rows.length, 1);
    assert.equal(retainedProject.rows[0].status, 'DELETED');
    assert.ok(retainedProject.rows[0].deleted_at);
    const retainedSettings = await query('SELECT project_id FROM hive.project_settings WHERE project_id = $1::uuid', [PROJECT_ID]);
    assert.equal(retainedSettings.rows.length, 1);
  });
}
