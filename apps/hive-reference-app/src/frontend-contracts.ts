import { languageForLocale as languageFromSupportedLocale } from '@green-hive/i18n';
import type { PlatformErrorCategory } from '@green-hive/core';

const FRIENDLY_ERRORS: Readonly<Record<string, string>> = {
  INVALID_AUTH_INPUT: 'Confira os dados informados e tente novamente.',
  AUTH_INVALID_CREDENTIALS: 'E-mail ou senha incorretos.',
  AUTH_SESSION_INVALID: 'Sua sessão expirou. Entre novamente.',
  AUTH_SIGN_UP_FAILED: 'Não foi possível criar a conta. O e-mail pode já estar em uso.',
  AUTH_RECOVERY_FAILED: 'Não foi possível iniciar a recuperação agora.',
  AUTH_RECOVERY_EXCHANGE_FAILED: 'Este link de recuperação é inválido ou expirou.',
  AUTH_PASSWORD_UPDATE_FAILED: 'Não foi possível atualizar a senha.',
  INVALID_ACCOUNT_INPUT: 'Revise os dados do perfil.',
  INVALID_PROJECT_INPUT: 'Informe um nome válido para o projeto.',
  PROJECT_NOT_FOUND: 'Projeto não encontrado.',
  INVALID_PROJECT_TRANSITION: 'Essa mudança não é permitida para o projeto.',
  INVALID_WORKSPACE_INPUT: 'Informe um nome válido para o workspace.',
  WORKSPACE_ACCESS_DENIED: 'Você não possui permissão para esta alteração.',
  WORKSPACE_NOT_FOUND: 'Workspace não encontrado.',
  AUTH_ORGANIZATION_ACCESS_DENIED: 'Sua sessão não possui acesso a este workspace.',
  AUDIT_ACCESS_DENIED: 'Você não possui acesso ao histórico deste workspace.',
  AUDIT_OPERATION_FAILED: 'Não foi possível carregar o histórico de atividades.',
};

const FRIENDLY_CATEGORIES: Readonly<Record<PlatformErrorCategory, string>> = {
  VALIDATION: 'Confira os dados informados e tente novamente.',
  UNAUTHENTICATED: 'Sua sessão expirou. Entre novamente.',
  FORBIDDEN: 'Você não possui permissão para esta ação.',
  NOT_FOUND: 'Não foi possível encontrar o item solicitado.',
  CONFLICT: 'Essa ação não pode ser concluída no estado atual.',
  RATE_LIMITED: 'Muitas tentativas em pouco tempo. Aguarde e tente novamente.',
  RESOURCE_EXHAUSTED: 'Este recurso não está disponível no momento.',
  UNAVAILABLE: 'O serviço está temporariamente indisponível. Tente novamente.',
  INTERNAL: 'Ocorreu um erro inesperado. Tente novamente.',
};

export function platformErrorCategory(value: string | undefined): PlatformErrorCategory {
  if (value && value in FRIENDLY_CATEGORIES) return value as PlatformErrorCategory;
  return 'INTERNAL';
}

/** Never render text supplied by an HTTP error response. */
export function clientErrorMessage(code: string, category: PlatformErrorCategory): string {
  return FRIENDLY_ERRORS[code] ?? FRIENDLY_CATEGORIES[category];
}

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
