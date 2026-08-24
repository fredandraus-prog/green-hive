export const LOCAL_SUPABASE_DATABASE_URL =
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
export const LOCAL_SUPABASE_TARGET = 'LOCAL_SUPABASE';
export const LOCAL_SUPABASE_CONFIRMATION = 'DROP_GREEN_HIVE_TEST_SCHEMAS';
export const LOCAL_SUPABASE_NETWORK = 'green-hive-local';
export const LOCAL_SUPABASE_FIREWALL_RULE = 'Green Hive Local Supabase PostgreSQL';

export const MANAGED_SCHEMAS = Object.freeze(['hive', 'audit', 'reference_app']);
export const FIXTURE_USER_IDS = Object.freeze([
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
]);
export const FIXTURE_APP_ID = '00000000-0000-4000-8000-000000000002';
export const FIXTURE_ORGANIZATION_IDS = Object.freeze([
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000003',
]);

function databaseName(parsedUrl) {
  return decodeURIComponent(parsedUrl.pathname.replace(/^\//, ''));
}

export function assertLocalSupabaseTarget({ databaseUrl, target, confirmation }) {
  if (!databaseUrl) throw new Error('GREEN_HIVE_TEST_DATABASE_URL is required');

  let parsedUrl;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error('GREEN_HIVE_TEST_DATABASE_URL must be a valid PostgreSQL URL');
  }

  if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol)) {
    throw new Error('Local Supabase gate requires a PostgreSQL URL');
  }
  if (!['127.0.0.1', 'localhost'].includes(parsedUrl.hostname.toLowerCase())) {
    throw new Error('Local Supabase gate requires host 127.0.0.1 or localhost');
  }
  if (parsedUrl.port !== '54322') {
    throw new Error('Local Supabase gate requires port 54322');
  }
  if (databaseName(parsedUrl) !== 'postgres') {
    throw new Error('Local Supabase gate requires database postgres');
  }
  if (target !== LOCAL_SUPABASE_TARGET) {
    throw new Error(`Local Supabase gate requires GREEN_HIVE_TEST_TARGET=${LOCAL_SUPABASE_TARGET}`);
  }
  if (confirmation !== LOCAL_SUPABASE_CONFIRMATION) {
    throw new Error(
      `Local Supabase gate requires GREEN_HIVE_TEST_CONFIRM=${LOCAL_SUPABASE_CONFIRMATION}`,
    );
  }

  return parsedUrl;
}

export function assertPermittedExternalTarget({ databaseUrl, target, confirmation }) {
  if (target === LOCAL_SUPABASE_TARGET) {
    return assertLocalSupabaseTarget({ databaseUrl, target, confirmation });
  }

  if (!databaseUrl || confirmation !== LOCAL_SUPABASE_CONFIRMATION) {
    throw new Error('Dedicated external test database and exact destructive confirmation are required');
  }
  const parsedUrl = new URL(databaseUrl);
  if (!databaseName(parsedUrl).toLowerCase().includes('test')) {
    throw new Error("External RLS suite refuses a database whose name does not contain 'test'");
  }
  return parsedUrl;
}

export async function assertNativeSupabaseContract(client) {
  const contract = await client.query(
    `SELECT
       current_database() AS database_name,
       current_setting('server_version_num')::integer AS server_version_num,
       to_regclass('auth.users')::text AS users,
       to_regprocedure('auth.uid()')::text AS uid,
       to_regprocedure('auth.jwt()')::text AS jwt,
       EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AS authenticated_role`,
  );
  const row = contract.rows[0];
  if (
    !row?.users ||
    !row?.uid ||
    !row?.jwt ||
    !row?.authenticated_role ||
    row.database_name !== 'postgres'
  ) {
    throw new Error(
      'Supabase gate requires native auth.users, auth.uid(), auth.jwt(), authenticated role and database postgres',
    );
  }

  const definitions = await client.query(
    `SELECT p.proname, pg_get_functiondef(p.oid) AS definition
     FROM pg_proc AS p
     JOIN pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'auth' AND p.proname IN ('uid', 'jwt')
     ORDER BY p.proname`,
  );
  if (
    definitions.rows.length !== 2 ||
    definitions.rows.some((entry) => !entry.definition.includes('current_setting'))
  ) {
    throw new Error('Supabase Auth helpers do not match the expected native session-claim contract');
  }

  return row;
}

export async function cleanupGreenHiveTestState(client) {
  await client.query('RESET ROLE').catch(() => undefined);
  await client.query('DROP SCHEMA IF EXISTS reference_app CASCADE');
  await client.query('DROP SCHEMA IF EXISTS audit CASCADE');
  await client.query('DROP SCHEMA IF EXISTS hive CASCADE');
  await client.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [FIXTURE_USER_IDS]);
}

export async function cleanupGreenHiveFixtures(client) {
  await client.query('RESET ROLE').catch(() => undefined);
  await cleanupGreenHiveUsers(client, FIXTURE_USER_IDS);
  await client.query('DELETE FROM hive.apps WHERE id = $1::uuid', [FIXTURE_APP_ID]);
}

export async function cleanupGreenHiveUsers(client, userIds) {
  await cleanupGreenHiveUserData(client, userIds);
  if (!Array.isArray(userIds) || userIds.length === 0) return;
  await client.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [userIds]);
}

export async function cleanupGreenHiveUserData(client, userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) return;
  await client.query('RESET ROLE').catch(() => undefined);
  const auditTable = await client.query("SELECT to_regclass('audit.events')::text AS events");
  if (auditTable.rows[0]?.events === 'audit.events') {
    await client.query(
      `DELETE FROM audit.events
       WHERE actor_user_id = ANY($1::uuid[])
          OR project_id IN (
            SELECT id FROM hive.projects WHERE owner_user_id = ANY($1::uuid[])
          )
          OR organization_id IN (
            SELECT id FROM hive.organizations
            WHERE created_by_user_id = ANY($1::uuid[])
               OR personal_owner_user_id = ANY($1::uuid[])
          )`,
      [userIds],
    );
  }
  const billingTables = await client.query(
    `SELECT
       to_regclass('hive.purchases')::text AS purchases,
       to_regclass('hive.payments')::text AS payments,
       to_regclass('hive.payment_provider_events')::text AS provider_events,
       to_regclass('hive.project_entitlements')::text AS entitlements,
       to_regclass('hive.usage_budgets')::text AS usage_budgets,
       to_regclass('hive.usage_events')::text AS usage_events,
       to_regclass('hive.cost_events')::text AS cost_events,
       to_regclass('hive.cost_guard_decisions')::text AS cost_guard_decisions,
       to_regclass('hive.cost_guard_reservations')::text AS cost_guard_reservations`,
  );
  if (billingTables.rows[0]?.cost_guard_reservations === 'hive.cost_guard_reservations') {
    await client.query(
      'DELETE FROM hive.cost_guard_reservations WHERE owner_user_id = ANY($1::uuid[])',
      [userIds],
    );
  }
  if (billingTables.rows[0]?.cost_guard_decisions === 'hive.cost_guard_decisions') {
    await client.query(
      'DELETE FROM hive.cost_guard_decisions WHERE owner_user_id = ANY($1::uuid[])',
      [userIds],
    );
  }
  if (billingTables.rows[0]?.cost_events === 'hive.cost_events') {
    await client.query('DELETE FROM hive.cost_events WHERE owner_user_id = ANY($1::uuid[])', [
      userIds,
    ]);
  }
  if (billingTables.rows[0]?.usage_events === 'hive.usage_events') {
    await client.query('DELETE FROM hive.usage_events WHERE owner_user_id = ANY($1::uuid[])', [
      userIds,
    ]);
  }
  if (billingTables.rows[0]?.usage_budgets === 'hive.usage_budgets') {
    await client.query('DELETE FROM hive.usage_budgets WHERE owner_user_id = ANY($1::uuid[])', [
      userIds,
    ]);
  }
  if (billingTables.rows[0]?.entitlements === 'hive.project_entitlements') {
    await client.query(
      'DELETE FROM hive.project_entitlements WHERE owner_user_id = ANY($1::uuid[])',
      [userIds],
    );
  }
  if (billingTables.rows[0]?.provider_events === 'hive.payment_provider_events') {
    await client.query(
      `DELETE FROM hive.payment_provider_events
       WHERE payment_id IN (
         SELECT id FROM hive.payments WHERE owner_user_id = ANY($1::uuid[])
       )`,
      [userIds],
    );
  }
  if (billingTables.rows[0]?.payments === 'hive.payments') {
    await client.query('DELETE FROM hive.payments WHERE owner_user_id = ANY($1::uuid[])', [
      userIds,
    ]);
  }
  if (billingTables.rows[0]?.purchases === 'hive.purchases') {
    await client.query('DELETE FROM hive.purchases WHERE owner_user_id = ANY($1::uuid[])', [
      userIds,
    ]);
  }
  await client.query(
    `DELETE FROM hive.project_settings
     WHERE project_id IN (
       SELECT id FROM hive.projects WHERE owner_user_id = ANY($1::uuid[])
     )`,
    [userIds],
  );
  await client.query('DELETE FROM hive.projects WHERE owner_user_id = ANY($1::uuid[])', [
    userIds,
  ]);
  await client.query(
    `DELETE FROM hive.organization_app_members
     WHERE user_id = ANY($1::uuid[])
        OR organization_id IN (
          SELECT id FROM hive.organizations
          WHERE created_by_user_id = ANY($1::uuid[])
             OR personal_owner_user_id = ANY($1::uuid[])
        )`,
    [userIds],
  );
  await client.query(
    `DELETE FROM hive.organization_apps
     WHERE organization_id IN (
       SELECT id FROM hive.organizations
       WHERE created_by_user_id = ANY($1::uuid[])
          OR personal_owner_user_id = ANY($1::uuid[])
     )`,
    [userIds],
  );
  await client.query(
    `DELETE FROM hive.organization_members
     WHERE user_id = ANY($1::uuid[])
        OR organization_id IN (
          SELECT id FROM hive.organizations
          WHERE created_by_user_id = ANY($1::uuid[])
             OR personal_owner_user_id = ANY($1::uuid[])
        )`,
    [userIds],
  );
  await client.query(
    `DELETE FROM hive.organizations
     WHERE created_by_user_id = ANY($1::uuid[])
        OR personal_owner_user_id = ANY($1::uuid[])`,
    [userIds],
  );
  await client.query('DELETE FROM hive.user_profiles WHERE user_id = ANY($1::uuid[])', [userIds]);
}
