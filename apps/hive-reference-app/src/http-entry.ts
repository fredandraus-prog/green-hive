import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  AuthService,
  PostgresAuthenticatedSessionRunner,
  SupabaseServerAuthProvider,
} from '@green-hive/auth';
import { AppRegistry } from '@green-hive/core';
import { createReferenceAppHttpServer } from './http-server.js';
import { referenceAppManifest } from './manifest.js';
import { ReferenceAppServer } from './server.js';

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required runtime configuration: ${name}`);
  return value;
}

function localPreviewGuard(origin: URL, databaseUrl: URL, authUrl: URL): void {
  if (process.env.GREEN_HIVE_RUNTIME_MODE !== 'LOCAL_PREVIEW') return;
  if (
    origin.origin !== 'http://127.0.0.1:3000' ||
    databaseUrl.hostname !== '127.0.0.1' ||
    databaseUrl.port !== '54322' ||
    authUrl.origin !== 'http://127.0.0.1:54321'
  ) {
    throw new Error('Local preview refuses non-loopback application, database or Auth endpoints');
  }
}

const appOrigin = new URL(process.env.GREEN_HIVE_APP_ORIGIN ?? 'http://127.0.0.1:3000');
const databaseUrl = new URL(requiredEnvironment('DATABASE_URL'));
const authUrl = new URL(requiredEnvironment('GREEN_HIVE_SUPABASE_AUTH_URL'));
const recoveryRedirect = requiredEnvironment('GREEN_HIVE_AUTH_RECOVERY_REDIRECT');
if (new URL(recoveryRedirect).origin !== appOrigin.origin) {
  throw new Error('Recovery redirect must use the exact application origin');
}
localPreviewGuard(appOrigin, databaseUrl, authUrl);

const pool = new pg.Pool({ connectionString: databaseUrl.toString(), max: 8 });
const registry = new AppRegistry();
registry.register(referenceAppManifest);
const provider = new SupabaseServerAuthProvider({
  authUrl: authUrl.toString().replace(/\/$/, ''),
  publishableKey: requiredEnvironment('GREEN_HIVE_SUPABASE_PUBLISHABLE_KEY'),
  serviceRoleKey: requiredEnvironment('GREEN_HIVE_SUPABASE_SERVICE_ROLE_KEY'),
});
const authService = new AuthService(provider, registry, {
  allowedRecoveryRedirects: [recoveryRedirect],
});
const facade = new ReferenceAppServer({
  authService,
  sessionRunner: new PostgresAuthenticatedSessionRunner(pool),
  recoveryRedirectUrl: recoveryRedirect,
});
const application = await createReferenceAppHttpServer({
  facade,
  allowedOrigin: appOrigin.origin,
  secureCookies: appOrigin.protocol === 'https:',
  webRoot: fileURLToPath(new URL('./web', import.meta.url)),
  logger: process.env.GREEN_HIVE_HTTP_LOGS === 'true',
});

const port = Number.parseInt(appOrigin.port || (appOrigin.protocol === 'https:' ? '443' : '80'), 10);
await application.listen({ host: appOrigin.hostname, port });
console.log(`Green Hive Reference App ready at ${appOrigin.origin}`);

let closing = false;
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  await application.close().catch(() => undefined);
  await pool.end().catch(() => undefined);
}

process.once('SIGINT', () => {
  void close().finally(() => process.exit(0));
});
process.once('SIGTERM', () => {
  void close().finally(() => process.exit(0));
});
