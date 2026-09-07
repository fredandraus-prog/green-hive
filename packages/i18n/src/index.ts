/**
 * Locale and message primitives shared by Green Hive applications.
 *
 * This package deliberately has no browser, React, database or authentication
 * dependency. A locale is a presentation preference only; it must never be
 * used to choose an app, a tenant, a role, or an authorization decision.
 */
export const I18N_STATUS = 'GH-0701' as const;

export const DEFAULT_LOCALE = 'pt-BR' as const;
export const SUPPORTED_LOCALES = Object.freeze(['pt-BR', 'en-US'] as const);

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type MessageValues = Readonly<Record<string, string | number>>;

const MESSAGES = {
  'pt-BR': {
    'brand.referenceApp': 'Reference App',
    'nav.dashboard': 'Painel',
    'nav.workspace': 'Workspace',
    'nav.projects': 'Projetos',
    'nav.activity': 'Atividade',
    'nav.notifications': 'Notificações',
    'nav.settings': 'Configurações',
    'nav.signOut': 'Sair da conta',
    'loading.workspace': 'Carregando seu espaço…',
    'settings.profile': 'Perfil',
    'settings.organization': 'Organização',
    'settings.language': 'Idioma',
    'settings.timezone': 'Fuso horário',
    'settings.save': 'Salvar alterações',
    'settings.saving': 'Salvando…',
    'settings.profileUpdated': 'Perfil atualizado com sucesso.',
    'projects.title': 'Projetos',
    'projects.description': 'Organize o trabalho operacional de {workspace}.',
    'projects.create': '+ Criar projeto',
    'projects.creating': 'Criando…',
    'projects.name': 'Nome do novo projeto',
    'projects.search': 'Buscar projetos',
    'projects.emptyTitle': 'Ainda não há projetos',
    'projects.emptyDescription': 'Crie o primeiro projeto deste workspace.',
    'projects.noneFound': 'Nenhum projeto encontrado',
    'projects.tryAnotherName': 'Tente buscar por outro nome.',
    'projects.createdAt': 'Criado em {date}',
    'projects.status.draft': 'Rascunho',
    'projects.status.active': 'Ativo',
    'projects.status.archived': 'Arquivado',
    'projects.archive': 'Arquivar',
    'projects.delete': 'Excluir',
    'activity.title': 'Atividade',
    'activity.recent': 'Atividade recente',
    'notifications.title': 'Notificações',
    'notifications.markRead': 'Marcar como lida',
    'notifications.marking': 'Marcando…',
    'notifications.read': 'Lida',
    'auth.signIn': 'Entrar',
    'auth.signingIn': 'Aguarde…',
    'auth.signUp': 'Criar conta',
    'auth.createAccount': 'Criar minha conta',
    'auth.haveAccount': 'Já tenho uma conta',
    'auth.email': 'E-mail',
    'auth.password': 'Senha',
    'auth.name': 'Nome',
    'auth.continue': 'Continuar',
    'auth.back': 'Voltar',
  },
  'en-US': {
    'brand.referenceApp': 'Reference App',
    'nav.dashboard': 'Dashboard',
    'nav.workspace': 'Workspace',
    'nav.projects': 'Projects',
    'nav.activity': 'Activity',
    'nav.notifications': 'Notifications',
    'nav.settings': 'Settings',
    'nav.signOut': 'Sign out',
    'loading.workspace': 'Loading your workspace…',
    'settings.profile': 'Profile',
    'settings.organization': 'Organization',
    'settings.language': 'Language',
    'settings.timezone': 'Time zone',
    'settings.save': 'Save changes',
    'settings.saving': 'Saving…',
    'settings.profileUpdated': 'Profile updated successfully.',
    'projects.title': 'Projects',
    'projects.description': 'Organize the operational work for {workspace}.',
    'projects.create': '+ Create project',
    'projects.creating': 'Creating…',
    'projects.name': 'New project name',
    'projects.search': 'Search projects',
    'projects.emptyTitle': 'There are no projects yet',
    'projects.emptyDescription': 'Create this workspace\'s first project.',
    'projects.noneFound': 'No projects found',
    'projects.tryAnotherName': 'Try another name.',
    'projects.createdAt': 'Created on {date}',
    'projects.status.draft': 'Draft',
    'projects.status.active': 'Active',
    'projects.status.archived': 'Archived',
    'projects.archive': 'Archive',
    'projects.delete': 'Delete',
    'activity.title': 'Activity',
    'activity.recent': 'Recent activity',
    'notifications.title': 'Notifications',
    'notifications.markRead': 'Mark as read',
    'notifications.marking': 'Marking…',
    'notifications.read': 'Read',
    'auth.signIn': 'Sign in',
    'auth.signingIn': 'Please wait…',
    'auth.signUp': 'Create account',
    'auth.createAccount': 'Create my account',
    'auth.haveAccount': 'I already have an account',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.name': 'Name',
    'auth.continue': 'Continue',
    'auth.back': 'Back',
  },
} as const;

export type TranslationKey = keyof (typeof MESSAGES)['pt-BR'];

export function resolveLocale(input: unknown): SupportedLocale {
  const candidates = Array.isArray(input) ? input : [input];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const normalized = candidate.trim().toLowerCase();
    const exact = SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === normalized);
    if (exact) return exact;
    const language = normalized.split('-')[0];
    const byLanguage = SUPPORTED_LOCALES.find((locale) => locale.split('-')[0] === language);
    if (byLanguage) return byLanguage;
  }
  return DEFAULT_LOCALE;
}

export function languageForLocale(locale: unknown): 'pt' | 'en' {
  return resolveLocale(locale).split('-')[0] as 'pt' | 'en';
}

export function translate(locale: unknown, key: TranslationKey, values: MessageValues = {}): string {
  const template = MESSAGES[resolveLocale(locale)][key] as string;
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  );
}

export function formatDateTime(locale: unknown, value: Date | number | string, options: Intl.DateTimeFormatOptions = {}, timeZone?: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(resolveLocale(locale), { ...options, ...(timeZone ? { timeZone } : {}) }).format(date);
  } catch {
    return new Intl.DateTimeFormat(DEFAULT_LOCALE, options).format(date);
  }
}

export interface Translator {
  readonly locale: SupportedLocale;
  readonly t: (key: TranslationKey, values?: MessageValues) => string;
  readonly formatDateTime: (value: Date | number | string, options?: Intl.DateTimeFormatOptions, timeZone?: string) => string;
}

export function createTranslator(locale: unknown): Translator {
  const resolved = resolveLocale(locale);
  return Object.freeze({
    locale: resolved,
    t: (key: TranslationKey, values: MessageValues = {}) => translate(resolved, key, values),
    formatDateTime: (value: Date | number | string, options: Intl.DateTimeFormatOptions = {}, timeZone?: string) =>
      formatDateTime(resolved, value, options, timeZone),
  });
}
