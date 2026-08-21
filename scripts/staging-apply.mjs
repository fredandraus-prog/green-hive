import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { runGreenHiveDatabaseSmoke } from './lib/green-hive-smoke.mjs';
import { runStagingPreflight } from './staging-preflight.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmEntrypoint =
  process.env.npm_execpath ??
  path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');

function runNpm(script, environment) {
  const result = spawnSync(process.execPath, [npmEntrypoint, 'run', script, '--silent'], {
    cwd: repositoryRoot,
    env: environment,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm run ${script} failed`);
}

console.log('== Green Hive dedicated Supabase staging apply ==');
const { configuration } = await runStagingPreflight({ databaseOnly: true });
const environment = {
  ...process.env,
  DATABASE_URL: configuration.databaseUrl.toString(),
  NODE_ENV: 'staging',
  ALLOW_PRODUCTION_SEED: 'true',
};

runNpm('db:validate', environment);
runNpm('db:migrate', environment);
runNpm('db:migrate', environment);
runNpm('db:seed', environment);
runNpm('db:seed', environment);

const client = new pg.Client({ connectionString: configuration.databaseUrl.toString() });
await client.connect();
try {
  const smoke = await runGreenHiveDatabaseSmoke(client, repositoryRoot);
  console.log(
    `Staging baseline passed: ledger=${smoke.ledgerRows}, REFERENCE_APP=${smoke.referenceApps}.`,
  );
} finally {
  await client.end();
}

console.log('No staging schema or user was deleted. Full HTTPS/Auth/SMTP acceptance is still separate.');
