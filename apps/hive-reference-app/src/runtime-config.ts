export const REFERENCE_APP_RUNTIME_MODES = Object.freeze({
  localPreview: 'LOCAL_PREVIEW',
  hostedStaging: 'HOSTED_STAGING',
} as const);

export type ReferenceAppRuntimeMode =
  (typeof REFERENCE_APP_RUNTIME_MODES)[keyof typeof REFERENCE_APP_RUNTIME_MODES];

export interface ReferenceAppRuntimeConfiguration {
  readonly mode: ReferenceAppRuntimeMode;
  readonly appOrigin: URL;
  readonly databaseUrl: URL;
  readonly authUrl: URL;
  readonly recoveryRedirect: URL;
  readonly publishableKey: string;
  readonly serviceRoleKey: string;
  readonly fakeBillingWebhookSecret: Uint8Array;
  readonly bindHost: '127.0.0.1' | '0.0.0.0';
  readonly bindPort: number;
  readonly poolMax: number;
  readonly secureCookies: boolean;
  readonly httpLogs: boolean;
}

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

const PROJECT_REF_PATTERN = /^[a-z]{20}$/;
const RESERVED_RENDER_PORTS = new Set([18012, 18013, 19099]);
const SUPABASE_ROOT_CA_PATH = './config/supabase-root-2021-ca.crt';

function required(environment: RuntimeEnvironment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing required runtime configuration: ${name}`);
  return value;
}

function parseUrl(value: string, name: string, protocols: readonly string[]): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${name} must use ${protocols.join(' or ')}`);
  }
  return parsed;
}

function parseOrigin(value: string, name: string, protocol: 'http:' | 'https:'): URL {
  const parsed = parseUrl(value, name, [protocol]);
  if (
    parsed.username ||
    parsed.password ||
    parsed.origin !== parsed.href.replace(/\/$/, '')
  ) {
    throw new Error(`${name} must be an exact origin without credentials, path, query or fragment`);
  }
  return parsed;
}

function parseBoolean(environment: RuntimeEnvironment, name: string): boolean {
  const value = required(environment, name);
  if (value !== 'true' && value !== 'false') {
    throw new Error(`${name} must be exactly true or false`);
  }
  return value === 'true';
}

function parseInteger(value: string, name: string, minimum: number, maximum: number): number {
  if (!/^[0-9]+$/.test(value)) throw new Error(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function parseDatabaseUrl(value: string): URL {
  const parsed = parseUrl(value, 'DATABASE_URL', ['postgres:', 'postgresql:']);
  if (!parsed.username || !parsed.password) {
    throw new Error('DATABASE_URL must contain dedicated database credentials');
  }
  if (decodeURIComponent(parsed.pathname.replace(/^\//, '')) !== 'postgres') {
    throw new Error('DATABASE_URL must select the postgres database');
  }
  return parsed;
}

function parseWebhookSecret(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43,86}$/.test(value)) {
    throw new Error('GREEN_HIVE_FAKE_WEBHOOK_SECRET must be a base64url secret');
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.byteLength < 32 || decoded.byteLength > 64) {
    throw new Error('GREEN_HIVE_FAKE_WEBHOOK_SECRET must decode to 32 through 64 bytes');
  }
  return Uint8Array.from(decoded);
}

function assertLocalPreview(
  environment: RuntimeEnvironment,
  appOrigin: URL,
  databaseUrl: URL,
  authUrl: URL,
  recoveryRedirect: URL,
): Pick<ReferenceAppRuntimeConfiguration, 'bindHost' | 'bindPort' | 'secureCookies'> {
  if (environment.NODE_ENV === 'production') {
    throw new Error('LOCAL_PREVIEW cannot run with NODE_ENV=production');
  }
  if (
    appOrigin.origin !== 'http://127.0.0.1:3000' ||
    databaseUrl.hostname !== '127.0.0.1' ||
    databaseUrl.port !== '54322' ||
    authUrl.href.replace(/\/$/, '') !== 'http://127.0.0.1:54321' ||
    recoveryRedirect.href !== 'http://127.0.0.1:3000/auth/recovery'
  ) {
    throw new Error('LOCAL_PREVIEW refuses non-canonical loopback endpoints');
  }
  return { bindHost: '127.0.0.1', bindPort: 3000, secureCookies: false };
}

function assertHostedStaging(
  environment: RuntimeEnvironment,
  appOrigin: URL,
  databaseUrl: URL,
  authUrl: URL,
  recoveryRedirect: URL,
): Pick<ReferenceAppRuntimeConfiguration, 'bindHost' | 'bindPort' | 'secureCookies'> {
  if (environment.NODE_ENV !== 'production') {
    throw new Error('HOSTED_STAGING requires NODE_ENV=production');
  }
  if (required(environment, 'NODE_EXTRA_CA_CERTS') !== SUPABASE_ROOT_CA_PATH) {
    throw new Error('HOSTED_STAGING requires the canonical Supabase root CA');
  }
  const projectRef = required(environment, 'GREEN_HIVE_STAGING_PROJECT_REF');
  if (!PROJECT_REF_PATTERN.test(projectRef)) {
    throw new Error('GREEN_HIVE_STAGING_PROJECT_REF must contain exactly 20 lowercase letters');
  }
  if (appOrigin.protocol !== 'https:' || ['localhost', '127.0.0.1', '::1'].includes(appOrigin.hostname)) {
    throw new Error('HOSTED_STAGING requires a non-loopback HTTPS application origin');
  }
  if (recoveryRedirect.href !== `${appOrigin.origin}/auth/recovery`) {
    throw new Error('Hosted recovery redirect must be the exact application /auth/recovery URL');
  }
  if (authUrl.href.replace(/\/$/, '') !== `https://${projectRef}.supabase.co/auth/v1`) {
    throw new Error('Hosted Auth URL must belong to the confirmed Supabase staging project');
  }
  if (databaseUrl.port !== '5432' || databaseUrl.searchParams.get('sslmode') !== 'verify-full') {
    throw new Error('Hosted DATABASE_URL must use port 5432 and sslmode=verify-full');
  }
  const directHost = `db.${projectRef}.supabase.co`;
  const sessionPooler =
    databaseUrl.hostname.endsWith('.pooler.supabase.com') &&
    decodeURIComponent(databaseUrl.username).endsWith(`.${projectRef}`);
  if (databaseUrl.hostname !== directHost && !sessionPooler) {
    throw new Error('Hosted DATABASE_URL does not belong to the confirmed staging project');
  }
  const bindPort = parseInteger(required(environment, 'PORT'), 'PORT', 1, 65535);
  if (RESERVED_RENDER_PORTS.has(bindPort)) throw new Error('PORT is reserved by the hosting runtime');
  return { bindHost: '0.0.0.0', bindPort, secureCookies: true };
}

export function referenceAppRuntimeConfiguration(
  environment: RuntimeEnvironment = process.env,
): ReferenceAppRuntimeConfiguration {
  const mode = required(environment, 'GREEN_HIVE_RUNTIME_MODE');
  if (mode !== REFERENCE_APP_RUNTIME_MODES.localPreview && mode !== REFERENCE_APP_RUNTIME_MODES.hostedStaging) {
    throw new Error('GREEN_HIVE_RUNTIME_MODE must be LOCAL_PREVIEW or HOSTED_STAGING');
  }
  const hosted = mode === REFERENCE_APP_RUNTIME_MODES.hostedStaging;
  const appOrigin = parseOrigin(
    required(environment, 'GREEN_HIVE_APP_ORIGIN'),
    'GREEN_HIVE_APP_ORIGIN',
    hosted ? 'https:' : 'http:',
  );
  const databaseUrl = parseDatabaseUrl(required(environment, 'DATABASE_URL'));
  const authUrl = parseUrl(
    required(environment, 'GREEN_HIVE_SUPABASE_AUTH_URL'),
    'GREEN_HIVE_SUPABASE_AUTH_URL',
    [hosted ? 'https:' : 'http:'],
  );
  if (authUrl.username || authUrl.password) {
    throw new Error('GREEN_HIVE_SUPABASE_AUTH_URL must not contain credentials');
  }
  const recoveryRedirect = parseUrl(
    required(environment, 'GREEN_HIVE_AUTH_RECOVERY_REDIRECT'),
    'GREEN_HIVE_AUTH_RECOVERY_REDIRECT',
    [hosted ? 'https:' : 'http:'],
  );
  const boundary = hosted
    ? assertHostedStaging(environment, appOrigin, databaseUrl, authUrl, recoveryRedirect)
    : assertLocalPreview(environment, appOrigin, databaseUrl, authUrl, recoveryRedirect);
  const poolMax = environment.GREEN_HIVE_DATABASE_POOL_MAX === undefined
    ? 5
    : parseInteger(environment.GREEN_HIVE_DATABASE_POOL_MAX.trim(), 'GREEN_HIVE_DATABASE_POOL_MAX', 1, 10);

  return Object.freeze({
    mode,
    appOrigin,
    databaseUrl,
    authUrl,
    recoveryRedirect,
    publishableKey: required(environment, 'GREEN_HIVE_SUPABASE_PUBLISHABLE_KEY'),
    serviceRoleKey: required(environment, 'GREEN_HIVE_SUPABASE_SERVICE_ROLE_KEY'),
    fakeBillingWebhookSecret: parseWebhookSecret(
      required(environment, 'GREEN_HIVE_FAKE_WEBHOOK_SECRET'),
    ),
    ...boundary,
    poolMax,
    httpLogs: parseBoolean(environment, 'GREEN_HIVE_HTTP_LOGS'),
  });
}
