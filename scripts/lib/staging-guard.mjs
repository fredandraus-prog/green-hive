export const SUPABASE_STAGING_TARGET = 'SUPABASE_STAGING';
export const SUPABASE_STAGING_CONFIRMATION = 'GREEN_HIVE_DEDICATED_STAGING';

const PROJECT_REF_PATTERN = /^[a-z]{20}$/;

function required(value, name) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function parseUrl(value, name, protocols) {
  let parsed;
  try {
    parsed = new URL(required(value, name));
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${name} must use ${protocols.join(' or ')}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${name} must not contain URL credentials`);
  }
  return parsed;
}

function parseDatabaseUrl(value, projectRef) {
  let parsed;
  try {
    parsed = new URL(required(value, 'GREEN_HIVE_STAGING_DATABASE_URL'));
  } catch {
    throw new Error('GREEN_HIVE_STAGING_DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('GREEN_HIVE_STAGING_DATABASE_URL must use PostgreSQL');
  }
  if (!parsed.password) {
    throw new Error('GREEN_HIVE_STAGING_DATABASE_URL must contain the staging database password');
  }
  if (decodeURIComponent(parsed.pathname.replace(/^\//, '')) !== 'postgres') {
    throw new Error('Supabase staging database name must be postgres');
  }
  if (parsed.port !== '5432') {
    throw new Error('Supabase staging must use the direct or session-pooler port 5432');
  }
  if (parsed.searchParams.get('sslmode') !== 'verify-full') {
    throw new Error('Supabase staging database URL must use sslmode=verify-full');
  }

  const directHost = `db.${projectRef}.supabase.co`;
  const poolerHost = parsed.hostname.endsWith('.pooler.supabase.com');
  const poolerUser = decodeURIComponent(parsed.username).endsWith(`.${projectRef}`);
  if (parsed.hostname !== directHost && !(poolerHost && poolerUser)) {
    throw new Error('Staging database URL does not belong to the confirmed Supabase project');
  }
  return parsed;
}

export function assertSupabaseStagingDatabaseConfiguration(input) {
  const projectRef = required(input.projectRef, 'GREEN_HIVE_STAGING_PROJECT_REF');
  if (!PROJECT_REF_PATTERN.test(projectRef)) {
    throw new Error('GREEN_HIVE_STAGING_PROJECT_REF must contain exactly 20 lowercase letters');
  }
  if (input.target !== SUPABASE_STAGING_TARGET) {
    throw new Error(
      `Staging gate requires GREEN_HIVE_STAGING_TARGET=${SUPABASE_STAGING_TARGET}`,
    );
  }
  if (input.confirmation !== SUPABASE_STAGING_CONFIRMATION) {
    throw new Error(
      `Staging gate requires GREEN_HIVE_STAGING_CONFIRM=${SUPABASE_STAGING_CONFIRMATION}`,
    );
  }

  const projectName = required(input.projectName, 'GREEN_HIVE_STAGING_PROJECT_NAME');
  const region = required(input.region, 'GREEN_HIVE_STAGING_REGION');
  const databaseUrl = parseDatabaseUrl(input.databaseUrl, projectRef);
  return Object.freeze({ projectRef, projectName, region, databaseUrl });
}

export function assertSupabaseStagingConfiguration(input) {
  const databaseConfiguration = assertSupabaseStagingDatabaseConfiguration(input);
  const { projectRef } = databaseConfiguration;
  const appOrigin = parseUrl(input.appOrigin, 'GREEN_HIVE_STAGING_APP_ORIGIN', ['https:']);
  if (appOrigin.origin !== appOrigin.href.replace(/\/$/, '')) {
    throw new Error('GREEN_HIVE_STAGING_APP_ORIGIN must be an origin without a path or query');
  }
  const authUrl = parseUrl(input.authUrl, 'GREEN_HIVE_SUPABASE_AUTH_URL', ['https:']);
  const expectedAuthUrl = `https://${projectRef}.supabase.co/auth/v1`;
  if (authUrl.href.replace(/\/$/, '') !== expectedAuthUrl) {
    throw new Error(
      'GREEN_HIVE_SUPABASE_AUTH_URL must be the canonical hosted GoTrue /auth/v1 URL',
    );
  }

  const recoveryRedirect = parseUrl(
    input.recoveryRedirect,
    'GREEN_HIVE_AUTH_RECOVERY_REDIRECT',
    ['https:'],
  );
  if (recoveryRedirect.href !== `${appOrigin.origin}/auth/recovery`) {
    throw new Error('Recovery redirect must be the exact HTTPS staging /auth/recovery URL');
  }

  return Object.freeze({
    ...databaseConfiguration,
    appOrigin,
    authUrl,
    recoveryRedirect,
  });
}

export function stagingDatabaseConfigurationFromEnvironment(environment = process.env) {
  return assertSupabaseStagingDatabaseConfiguration({
    projectRef: environment.GREEN_HIVE_STAGING_PROJECT_REF,
    projectName: environment.GREEN_HIVE_STAGING_PROJECT_NAME,
    region: environment.GREEN_HIVE_STAGING_REGION,
    target: environment.GREEN_HIVE_STAGING_TARGET,
    confirmation: environment.GREEN_HIVE_STAGING_CONFIRM,
    databaseUrl: environment.GREEN_HIVE_STAGING_DATABASE_URL,
  });
}

export function stagingConfigurationFromEnvironment(environment = process.env) {
  return assertSupabaseStagingConfiguration({
    projectRef: environment.GREEN_HIVE_STAGING_PROJECT_REF,
    projectName: environment.GREEN_HIVE_STAGING_PROJECT_NAME,
    region: environment.GREEN_HIVE_STAGING_REGION,
    target: environment.GREEN_HIVE_STAGING_TARGET,
    confirmation: environment.GREEN_HIVE_STAGING_CONFIRM,
    appOrigin: environment.GREEN_HIVE_STAGING_APP_ORIGIN,
    authUrl: environment.GREEN_HIVE_SUPABASE_AUTH_URL,
    recoveryRedirect: environment.GREEN_HIVE_AUTH_RECOVERY_REDIRECT,
    databaseUrl: environment.GREEN_HIVE_STAGING_DATABASE_URL,
  });
}
