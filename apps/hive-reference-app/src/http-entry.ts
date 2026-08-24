import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  AuthService,
  PostgresAuthenticatedSessionRunner,
  SupabaseServerAuthProvider,
} from '@green-hive/auth';
import {
  BillingWebhookService,
  FakeBillingWebhookVerifier,
  PostgresBillingWebhookRepository,
  type BillingSqlExecutor,
} from '@green-hive/billing';
import { AppRegistry } from '@green-hive/core';
import { createReferenceAppHttpServer } from './http-server.js';
import { referenceAppManifest } from './manifest.js';
import { createReferenceAppReadinessCheck } from './readiness.js';
import { referenceAppRuntimeConfiguration } from './runtime-config.js';
import { ReferenceAppServer } from './server.js';

const configuration = referenceAppRuntimeConfiguration();
const pool = new pg.Pool({
  connectionString: configuration.databaseUrl.toString(),
  max: configuration.poolMax,
});
const billingDatabase: BillingSqlExecutor = {
  async query<Row extends Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = [],
  ) {
    const result = await pool.query<Row>(sql, [...parameters]);
    return { rows: result.rows };
  },
};
const registry = new AppRegistry();
registry.register(referenceAppManifest);
const provider = new SupabaseServerAuthProvider({
  authUrl: configuration.authUrl.toString().replace(/\/$/, ''),
  publishableKey: configuration.publishableKey,
  serviceRoleKey: configuration.serviceRoleKey,
});
const authService = new AuthService(provider, registry, {
  allowedRecoveryRedirects: [configuration.recoveryRedirect.href],
});
const facade = new ReferenceAppServer({
  authService,
  sessionRunner: new PostgresAuthenticatedSessionRunner(pool),
  recoveryRedirectUrl: configuration.recoveryRedirect.href,
});
const readinessCheck = createReferenceAppReadinessCheck(pool);
const billingWebhookService = new BillingWebhookService(
  new PostgresBillingWebhookRepository(billingDatabase),
  [new FakeBillingWebhookVerifier({ secret: configuration.fakeBillingWebhookSecret })],
);
const application = await createReferenceAppHttpServer({
  facade,
  allowedOrigin: configuration.appOrigin.origin,
  secureCookies: configuration.secureCookies,
  readinessCheck,
  webRoot: fileURLToPath(new URL('./web', import.meta.url)),
  logger: configuration.httpLogs,
  billingWebhookService,
});

await readinessCheck();
await application.listen({ host: configuration.bindHost, port: configuration.bindPort });
console.log(
  `Green Hive Reference App ready in ${configuration.mode} at ${configuration.appOrigin.origin}`,
);

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
