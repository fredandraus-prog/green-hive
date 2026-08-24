import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootManifestPath = path.join(repositoryRoot, 'package.json');
const rootManifest = JSON.parse(await readFile(rootManifestPath, 'utf8'));
const platformVersion = rootManifest.version;
const packageNames = [
  'core',
  'auth',
  'projects',
  'billing',
  'entitlements',
  'cost-guard',
  'jobs',
  'ai',
  'search',
  'trust',
  'files',
  'audit',
  'i18n',
  'feature-flags',
  'notifications',
  'observability',
  'ui',
  'sdk',
];

const packageDependencies = (name) => {
  if (name === 'auth') {
    return {
      '@green-hive/core': platformVersion,
      '@supabase/supabase-js': '2.112.3',
    };
  }
  if (
    name === 'projects'
    || name === 'billing'
    || name === 'entitlements'
    || name === 'cost-guard'
  ) {
    return { '@green-hive/core': platformVersion };
  }
  return undefined;
};

const packageReferences = (name) =>
  name === 'auth'
    || name === 'projects'
    || name === 'billing'
    || name === 'entitlements'
    || name === 'cost-guard'
    ? [{ path: '../core' }]
    : [];

const packageManifest = (name) => ({
  name: `@green-hive/${name}`,
  version: platformVersion,
  private: true,
  type: 'module',
  main: './dist/index.js',
  types: './dist/index.d.ts',
  exports: {
    '.': {
      types: './dist/index.d.ts',
      default: './dist/index.js',
    },
  },
  files: ['dist'],
  ...(packageDependencies(name) ? { dependencies: packageDependencies(name) } : {}),
});

const projectConfig = (references = [], options = {}) => ({
  extends: '../../tsconfig.base.json',
  compilerOptions: {
    rootDir: 'src',
    outDir: 'dist',
    tsBuildInfoFile: 'dist/.tsbuildinfo',
    ...(options.web ? { jsx: 'react-jsx', types: ['node', 'react', 'react-dom'] } : {}),
  },
  include: options.web ? ['src/**/*.ts', 'src/**/*.tsx'] : ['src/**/*.ts'],
  ...(references.length > 0 ? { references } : {}),
});

for (const name of packageNames) {
  const directory = path.join(repositoryRoot, 'packages', name);
  const sourceEntries = await readdir(path.join(directory, 'src'));
  if (!sourceEntries.some((entry) => entry.endsWith('.ts'))) {
    throw new Error(`Canonical package ${name} has no TypeScript source`);
  }
  await writeFile(
    path.join(directory, 'package.json'),
    `${JSON.stringify(packageManifest(name), null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    path.join(directory, 'tsconfig.json'),
    `${JSON.stringify(projectConfig(packageReferences(name)), null, 2)}\n`,
    'utf8',
  );
}

const apps = [
  {
    directory: 'hive-reference-app',
    name: '@green-hive/hive-reference-app',
    dependencies: {
      '@fastify/cookie': '11.1.2',
      '@fastify/static': '10.1.3',
      '@green-hive/auth': platformVersion,
      '@green-hive/audit': platformVersion,
      '@green-hive/billing': platformVersion,
      '@green-hive/core': platformVersion,
      '@green-hive/cost-guard': platformVersion,
      '@green-hive/entitlements': platformVersion,
      '@green-hive/projects': platformVersion,
      fastify: '5.12.1',
      pg: '8.23.0',
      react: '19.2.8',
      'react-dom': '19.2.8',
    },
    web: true,
    references: [
      { path: '../../packages/core' },
      { path: '../../packages/auth' },
      { path: '../../packages/audit' },
      { path: '../../packages/billing' },
      { path: '../../packages/entitlements' },
      { path: '../../packages/cost-guard' },
      { path: '../../packages/projects' },
    ],
  },
  {
    directory: 'hive-admin',
    name: '@green-hive/hive-admin',
    dependencies: undefined,
    references: [],
  },
];

for (const app of apps) {
  const directory = path.join(repositoryRoot, 'apps', app.directory);
  const manifest = {
    name: app.name,
    version: platformVersion,
    private: true,
    type: 'module',
    main: './dist/index.js',
    types: './dist/index.d.ts',
    exports: {
      '.': {
        types: './dist/index.d.ts',
        default: './dist/index.js',
      },
    },
    files: ['dist'],
    ...(app.dependencies ? { dependencies: app.dependencies } : {}),
  };
  await writeFile(
    path.join(directory, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    path.join(directory, 'tsconfig.json'),
    `${JSON.stringify(projectConfig(app.references, { web: app.web === true }), null, 2)}\n`,
    'utf8',
  );
}

rootManifest.workspaces = ['apps/*', 'packages/*'];
await writeFile(rootManifestPath, `${JSON.stringify(rootManifest, null, 2)}\n`, 'utf8');

console.log('Normalized 18 canonical packages and 2 apps.');
