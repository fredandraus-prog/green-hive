import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  LOCAL_SUPABASE_FIREWALL_RULE,
  LOCAL_SUPABASE_NETWORK,
} from './lib/local-supabase-guard.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const command = process.argv[2] ?? 'status';
const runtimeEnvironment = { ...process.env };
const excludedServices = [
  'realtime',
  'storage-api',
  'imgproxy',
  'kong',
  'mailpit',
  'postgrest',
  'postgres-meta',
  'studio',
  'edge-runtime',
  'logflare',
  'vector',
  'supavisor',
].join(',');

const supabaseEntrypoint = path.join(repositoryRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
const authContainer = 'supabase_auth_green-hive';
const mailpitContainer = 'supabase_inbucket_green-hive';
const mailpitImage = 'public.ecr.aws/supabase/mailpit:v1.30.2';

function findDocker() {
  const candidates = [
    process.platform === 'win32' && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Programs', 'DockerDesktop', 'resources', 'bin', 'docker.exe')
      : undefined,
    'docker',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate !== 'docker' && existsSync(candidate)) return candidate;
    if (candidate === 'docker') {
      const checked = spawnSync(candidate, ['version', '--format', '{{.Client.Version}}'], {
        encoding: 'utf8',
      });
      if (!checked.error && checked.status === 0) return candidate;
    }
  }
  throw new Error('Docker CLI was not found. Start Docker Desktop and retry.');
}

function run(executable, argumentsList, options = {}) {
  const result = spawnSync(executable, argumentsList, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    env: runtimeEnvironment,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    const detail = options.capture ? `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() : '';
    throw new Error(`${path.basename(executable)} ${argumentsList.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

function runSensitive(executable, argumentsList, failureMessage) {
  const result = spawnSync(executable, argumentsList, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    env: runtimeEnvironment,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(failureMessage);
  return result;
}

function runSupabase(argumentsList, options) {
  if (!existsSync(supabaseEntrypoint)) {
    throw new Error('Versioned Supabase CLI is missing. Run npm ci first.');
  }
  return run(process.execPath, [supabaseEntrypoint, ...argumentsList], options);
}

function ensureLocalNetwork(docker) {
  const inspected = run(
    docker,
    [
      'network',
      'inspect',
      LOCAL_SUPABASE_NETWORK,
      '--format',
      '{{index .Options "com.docker.network.bridge.host_binding_ipv4"}}',
    ],
    { capture: true, allowFailure: true },
  );
  if (inspected.status !== 0) {
    run(docker, [
      'network',
      'create',
      '-o',
      'com.docker.network.bridge.host_binding_ipv4=127.0.0.1',
      LOCAL_SUPABASE_NETWORK,
    ]);
    return;
  }
  if (inspected.stdout.trim() !== '127.0.0.1') {
    throw new Error(
      `Docker network ${LOCAL_SUPABASE_NETWORK} exists without the required localhost binding`,
    );
  }
}

function verifyWindowsFirewall() {
  if (process.platform !== 'win32') return;
  const script = [
    `$r = Get-NetFirewallRule -DisplayName '${LOCAL_SUPABASE_FIREWALL_RULE}' -ErrorAction SilentlyContinue`,
    "if (-not $r -or $r.Enabled -ne 'True' -or $r.Direction -ne 'Inbound' -or $r.Action -ne 'Block') { exit 4 }",
  ].join('; ');
  const checked = run('powershell.exe', ['-NoProfile', '-Command', script], {
    capture: true,
    allowFailure: true,
  });
  if (checked.status !== 0) {
    throw new Error(
      `Windows firewall rule '${LOCAL_SUPABASE_FIREWALL_RULE}' is required before the local database may run`,
    );
  }
}

function removeLoopbackServices(docker) {
  for (const container of [mailpitContainer, authContainer]) {
    run(docker, ['rm', '--force', container], { capture: true, allowFailure: true });
  }
}

function containerInspection(docker, container) {
  const inspected = run(docker, ['inspect', container], { capture: true });
  const value = JSON.parse(inspected.stdout)[0];
  if (!value) throw new Error(`Docker container ${container} could not be inspected`);
  return value;
}

function labelsForCurrentProject() {
  return {
    'com.docker.compose.project': 'green-hive',
    'com.supabase.cli.project': 'green-hive',
    'com.supabase.cli.workdir': repositoryRoot,
  };
}

function appendLabels(argumentsList, labels) {
  for (const [name, value] of Object.entries(labels)) {
    argumentsList.push('--label', `${name}=${value}`);
  }
}

function recreateAuthOnLoopback(docker) {
  const inspected = containerInspection(docker, authContainer);
  const configuration = inspected.Config;
  run(docker, ['rm', '--force', authContainer], { capture: true });

  const argumentsList = [
    'run',
    '--detach',
    '--name',
    authContainer,
    '--network',
    LOCAL_SUPABASE_NETWORK,
    '--network-alias',
    'auth',
    '--publish',
    '127.0.0.1:54321:9999',
    '--restart',
    'unless-stopped',
  ];
  appendLabels(argumentsList, labelsForCurrentProject());
  for (const environmentEntry of configuration.Env ?? []) {
    argumentsList.push('--env', environmentEntry);
  }
  const health = configuration.Healthcheck;
  if (health?.Test?.[0] === 'CMD-SHELL' && health.Test[1]) {
    argumentsList.push('--health-cmd', health.Test[1]);
    if (health.Interval) argumentsList.push('--health-interval', `${health.Interval}ns`);
    if (health.Timeout) argumentsList.push('--health-timeout', `${health.Timeout}ns`);
    if (health.Retries) argumentsList.push('--health-retries', String(health.Retries));
  }
  if (configuration.Entrypoint?.[0]) {
    argumentsList.push('--entrypoint', configuration.Entrypoint[0]);
  }
  argumentsList.push(configuration.Image, ...(configuration.Cmd ?? []));
  runSensitive(docker, argumentsList, 'Could not bind Supabase Auth exclusively to 127.0.0.1');
}

function startMailpitOnLoopback(docker) {
  run(docker, ['rm', '--force', mailpitContainer], { capture: true, allowFailure: true });
  const argumentsList = [
    'run',
    '--detach',
    '--name',
    mailpitContainer,
    '--network',
    LOCAL_SUPABASE_NETWORK,
    '--network-alias',
    mailpitContainer,
    '--publish',
    '127.0.0.1:54324:8025',
    '--restart',
    'unless-stopped',
    '--env',
    'MP_SMTP_BIND_ADDR=0.0.0.0:1025',
    '--env',
    'MP_UI_BIND_ADDR=0.0.0.0:8025',
  ];
  appendLabels(argumentsList, labelsForCurrentProject());
  argumentsList.push(mailpitImage);
  runSensitive(docker, argumentsList, 'Could not bind local Mailpit exclusively to 127.0.0.1');
}

function waitForHealthyContainer(docker, container) {
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const inspected = run(
      docker,
      ['inspect', container, '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}'],
      { capture: true, allowFailure: true },
    );
    const status = inspected.stdout.trim();
    if (status === 'healthy' || status === 'running') return;
    if (status === 'unhealthy' || status === 'exited' || status === 'dead') {
      throw new Error(`${container} entered unsafe state ${status}`);
    }
    Atomics.wait(pause, 0, 0, 1000);
  }
  throw new Error(`${container} did not become healthy within 60 seconds`);
}

function assertLoopbackBinding(docker, container, containerPort, hostPort) {
  const inspected = containerInspection(docker, container);
  const bindings = inspected.NetworkSettings?.Ports?.[`${containerPort}/tcp`];
  if (
    !Array.isArray(bindings) ||
    bindings.length !== 1 ||
    bindings[0]?.HostIp !== '127.0.0.1' ||
    bindings[0]?.HostPort !== String(hostPort)
  ) {
    throw new Error(`${container} must bind ${hostPort} exclusively to 127.0.0.1`);
  }
}

function secureAuthServices(docker) {
  startMailpitOnLoopback(docker);
  recreateAuthOnLoopback(docker);
  waitForHealthyContainer(docker, mailpitContainer);
  waitForHealthyContainer(docker, authContainer);
  assertLoopbackBinding(docker, authContainer, 9999, 54321);
  assertLoopbackBinding(docker, mailpitContainer, 8025, 54324);
}

function verifyAuthServices(docker) {
  waitForHealthyContainer(docker, authContainer);
  waitForHealthyContainer(docker, mailpitContainer);
  assertLoopbackBinding(docker, authContainer, 9999, 54321);
  assertLoopbackBinding(docker, mailpitContainer, 8025, 54324);
}

const docker = findDocker();
if (path.isAbsolute(docker)) {
  const pathKey = Object.keys(runtimeEnvironment).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  runtimeEnvironment[pathKey] = `${path.dirname(docker)}${path.delimiter}${runtimeEnvironment[pathKey] ?? ''}`;
}
run(docker, ['version', '--format', 'Docker client={{.Client.Version}} server={{.Server.Version}}']);

if (command === 'start') {
  ensureLocalNetwork(docker);
  verifyWindowsFirewall();
  runSupabase([
    'start',
    '--network-id',
    LOCAL_SUPABASE_NETWORK,
    '--exclude',
    excludedServices,
  ], { capture: true });
  secureAuthServices(docker);
  run(docker, ['inspect', 'supabase_db_green-hive', '--format', 'Supabase DB {{.State.Health.Status}}']);
  run(docker, ['inspect', 'supabase_auth_green-hive', '--format', 'Supabase Auth {{.State.Health.Status}}']);
} else if (command === 'status') {
  runSupabase(['status', '--output', 'json'], { capture: true });
  verifyWindowsFirewall();
  verifyAuthServices(docker);
  console.log('Supabase local database, Auth and Mailpit are healthy and locally protected.');
} else if (command === 'stop') {
  removeLoopbackServices(docker);
  runSupabase(['stop']);
} else if (command === 'reset') {
  removeLoopbackServices(docker);
  runSupabase(['stop', '--no-backup']);
} else {
  throw new Error(`Unknown Supabase local command: ${command}`);
}
