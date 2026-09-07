import { languageForLocale as languageFromSupportedLocale } from '@green-hive/i18n';

export const APP_ROUTES = Object.freeze({
  dashboard: '/app/dashboard',
  workspaceProjects: '/app/workspace/projects',
  workspaceActivity: '/app/workspace/activity',
  workspaceNotifications: '/app/workspace/notifications',
  settingsProfile: '/app/settings/profile',
  settingsOrganization: '/app/settings/organization',
} as const);

export type AppRoute = keyof typeof APP_ROUTES;

const ROUTE_BY_PATH = new Map<string, AppRoute>(
  Object.entries(APP_ROUTES).map(([route, path]) => [path, route as AppRoute]),
);

const LEGACY_HASH_ROUTES = new Map<string, AppRoute>([
  ['#projects', 'workspaceProjects'],
  ['#activity', 'workspaceActivity'],
  ['#notifications', 'workspaceNotifications'],
  ['#profile', 'settingsProfile'],
]);

export function resolveAppRoute(pathname: string, hash = ''): AppRoute {
  if (pathname === '/app') return LEGACY_HASH_ROUTES.get(hash) ?? 'dashboard';
  return ROUTE_BY_PATH.get(pathname) ?? 'dashboard';
}

export function go(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export type PortfolioScope =
  | { readonly mode: 'ALL_WORKSPACES'; readonly selectedWorkspaceIds: readonly string[] }
  | { readonly mode: 'SELECTED_WORKSPACES'; readonly selectedWorkspaceIds: readonly string[] };

export const DEFAULT_PORTFOLIO_SCOPE: PortfolioScope = Object.freeze({
  mode: 'ALL_WORKSPACES',
  selectedWorkspaceIds: Object.freeze([]),
});

export function selectedPortfolioScope(workspaceIds: readonly string[]): PortfolioScope {
  return {
    mode: 'SELECTED_WORKSPACES',
    selectedWorkspaceIds: Object.freeze([...new Set(workspaceIds)]),
  };
}

export const SIGN_UP_FIELD_NAMES = Object.freeze([
  'displayName',
  'email',
  'password',
  'preferredLocale',
  'timezone',
  'organizationName',
] as const);

export interface LanguageOption {
  readonly language: string;
  readonly locale: string;
  readonly label: string;
}

export const LANGUAGE_OPTIONS: readonly LanguageOption[] = Object.freeze([
  { language: 'pt', locale: 'pt-BR', label: 'Português (Brasil)' },
  { language: 'en', locale: 'en-US', label: 'English (United States)' },
]);

export const COMMON_TIMEZONES = Object.freeze([
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Recife',
  'America/New_York',
  'Europe/Lisbon',
  'Europe/London',
  'UTC',
] as const);

export interface InitialPreferences {
  readonly locale: string;
  readonly language: string;
  readonly timezone: string;
}

export function detectInitialPreferences(
  browserLocales: readonly string[] = [],
  detectedTimezone?: string,
): InitialPreferences {
  const normalizedLocales = browserLocales.map((entry) => entry.trim()).filter(Boolean);
  const option = LANGUAGE_OPTIONS.find((candidate) =>
    normalizedLocales.some((locale) => locale.toLowerCase() === candidate.locale.toLowerCase()),
  ) ?? LANGUAGE_OPTIONS.find((candidate) =>
    normalizedLocales.some((locale) => {
      const normalized = locale.toLowerCase();
      return normalized === candidate.language || normalized.startsWith(`${candidate.language}-`);
    }),
  ) ?? LANGUAGE_OPTIONS[0];

  if (!option) throw new Error('At least one language option is required');
  const timezone = typeof detectedTimezone === 'string' && detectedTimezone.trim().length > 0
    ? detectedTimezone.trim()
    : 'UTC';
  return { locale: option.locale, language: option.language, timezone };
}

export function languageForLocale(locale: string): string {
  return languageFromSupportedLocale(locale);
}

function normalizedSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim();
}

export function projectMatchesSearch(projectName: string, query: string): boolean {
  const normalizedQuery = normalizedSearch(query);
  return normalizedQuery.length === 0 || normalizedSearch(projectName).includes(normalizedQuery);
}
