import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  APP_ROUTES,
  DEFAULT_PORTFOLIO_SCOPE,
  detectInitialPreferences,
  projectMatchesSearch,
  resolveAppRoute,
  selectedPortfolioScope,
  SIGN_UP_FIELD_NAMES,
} from '../../apps/hive-reference-app/dist/frontend-contracts.js';

const WEB_ROOT = new URL('../../apps/hive-reference-app/src/web/', import.meta.url);

async function source(file) {
  return readFile(new URL(file, WEB_ROOT), 'utf8');
}

test('authenticated navigation has a global Dashboard and separate workspace/settings routes', () => {
  assert.equal(resolveAppRoute('/app'), 'dashboard');
  assert.equal(resolveAppRoute(APP_ROUTES.dashboard), 'dashboard');
  assert.equal(resolveAppRoute(APP_ROUTES.workspaceProjects), 'workspaceProjects');
  assert.equal(resolveAppRoute(APP_ROUTES.settingsProfile), 'settingsProfile');
  assert.equal(resolveAppRoute('/app', '#profile'), 'settingsProfile');
  assert.notEqual(APP_ROUTES.dashboard, APP_ROUTES.workspaceProjects);
});

test('portfolio scope is global by default and already supports selected workspace ids', () => {
  assert.deepEqual(DEFAULT_PORTFOLIO_SCOPE, {
    mode: 'ALL_WORKSPACES',
    selectedWorkspaceIds: [],
  });
  assert.deepEqual(selectedPortfolioScope(['workspace-a', 'workspace-a', 'workspace-b']), {
    mode: 'SELECTED_WORKSPACES',
    selectedWorkspaceIds: ['workspace-a', 'workspace-b'],
  });
});

test('project search matches names without depending on case or accents', () => {
  assert.equal(projectMatchesSearch('Implantação São Paulo', 'sao'), true);
  assert.equal(projectMatchesSearch('Projeto Principal', 'PRINCIPAL'), true);
  assert.equal(projectMatchesSearch('Projeto Principal', 'financeiro'), false);
});

test('signup contract contains account, language, timezone and organization fields with safe defaults', () => {
  assert.deepEqual(SIGN_UP_FIELD_NAMES, [
    'displayName',
    'email',
    'password',
    'preferredLocale',
    'timezone',
    'organizationName',
  ]);
  assert.deepEqual(detectInitialPreferences(['pt-BR'], 'America/Sao_Paulo'), {
    language: 'pt',
    locale: 'pt-BR',
    timezone: 'America/Sao_Paulo',
  });
  assert.equal(detectInitialPreferences(['en'], 'UTC').locale, 'en-US');
  assert.equal(detectInitialPreferences([], undefined).timezone, 'UTC');
});

test('normal product UI omits infrastructure status and keeps profile outside Dashboard', async () => {
  const [authenticated, auth, switcher, ui] = await Promise.all([
    source('authenticated-app.tsx'),
    source('auth-pages.tsx'),
    source('workspace-switcher.tsx'),
    source('ui.tsx'),
  ]);
  const allProductUi = [authenticated, auth, switcher, ui].join('\n');
  assert.doesNotMatch(allProductUi, /RLS ativo|Isolamento|tenant context|correlation id/i);

  const dashboardSource = authenticated.slice(
    authenticated.indexOf('function DashboardView'),
    authenticated.indexOf('function ProjectsView'),
  );
  assert.doesNotMatch(dashboardSource, /ProfileSettings|Meu perfil|displayName|Organizations Foundation|Criar workspace/i);
  assert.match(authenticated, /function ProfileSettingsView/);
  assert.match(authenticated, /function OrganizationSettingsView/);
  assert.match(authenticated, /> Configurações/);
});

test('workspace selector exposes an accessible menu, selection and dialog creation action', async () => {
  const switcher = await source('workspace-switcher.tsx');
  assert.match(switcher, /aria-haspopup="menu"/);
  assert.match(switcher, /aria-expanded=\{open\}/);
  assert.match(switcher, /role="menuitemradio"/);
  assert.match(switcher, /void onSelect\(workspace\.id\)/);
  assert.match(switcher, /Criar workspace/);
  assert.match(switcher, /showModal\(\)/);
  assert.match(switcher, /if \(busy\) return/);
});

test('projects expose a real name filter with a magnifying-glass control', async () => {
  const authenticated = await source('authenticated-app.tsx');
  assert.match(authenticated, /aria-label="Buscar projetos"/);
  assert.match(authenticated, /type="search"/);
  assert.match(authenticated, /projectMatchesSearch\(project\.name, search\)/);
  assert.match(authenticated, /Nenhum projeto encontrado/);
});

test('two-step signup renders all required onboarding labels', async () => {
  const auth = await source('auth-pages.tsx');
  for (const label of ['Nome', 'E-mail', 'Senha', 'Idioma', 'Fuso horário', 'Nome da organização']) {
    assert.match(auth, new RegExp(`label="${label}"`));
  }
  assert.match(auth, /Etapa 1 de 2/);
  assert.match(auth, /Etapa 2 de 2/);
  assert.match(auth, /\/api\/auth\/sign-in/);
  assert.match(auth, /\/api\/auth\/sign-up/);
});
