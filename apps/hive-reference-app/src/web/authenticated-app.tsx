import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiFailure } from './api.js';
import {
  APP_ROUTES,
  DEFAULT_PORTFOLIO_SCOPE,
  go,
  languageForLocale,
  LANGUAGE_OPTIONS,
  COMMON_TIMEZONES,
  projectMatchesSearch,
  type AppRoute,
} from '../frontend-contracts.js';
import type { AccountView, AuditEvent, Profile, Project, Workspace } from './types.js';
import { Brand, Breadcrumbs, Field, LoadingPanel, Message, SelectField } from './ui.js';
import { CreateWorkspaceDialog, WorkspaceSwitcher } from './workspace-switcher.js';

const AUDIT_EVENT_LABELS: Readonly<Record<string, string>> = {
  ORGANIZATION_CREATED: 'Workspace criado',
  ORGANIZATION_MEMBER_ADDED: 'Membro adicionado',
  ORGANIZATION_MEMBER_CHANGED: 'Membro atualizado',
  ORGANIZATION_APP_INSTALLED: 'Aplicativo instalado',
  PROJECT_CREATED: 'Projeto criado',
  PROJECT_ARCHIVED: 'Projeto arquivado',
  PROJECT_DELETION_REQUESTED: 'Projeto removido',
};

const ROLE_LABELS: Readonly<Record<Workspace['role'], string>> = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  DEVELOPER: 'Desenvolvedor',
  ANALYST: 'Analista',
  VIEWER: 'Visualizador',
};

function NavLink({ href, active, children, onNavigate }: {
  readonly href: string;
  readonly active: boolean;
  readonly children: ReactNode;
  readonly onNavigate: () => void;
}): ReactNode {
  return (
    <a
      className={active ? 'active' : undefined}
      href={href}
      aria-current={active ? 'page' : undefined}
      onClick={(event) => {
        event.preventDefault();
        onNavigate();
        go(href);
      }}
    >
      {children}
    </a>
  );
}

function AppSidebar({ route, workspaces, activeWorkspace, workspaceBusy, onSelectWorkspace, onCreateWorkspace, onSignOut }: {
  readonly route: AppRoute;
  readonly workspaces: readonly Workspace[];
  readonly activeWorkspace: Workspace | null;
  readonly workspaceBusy: boolean;
  readonly onSelectWorkspace: (workspaceId: string) => Promise<boolean>;
  readonly onCreateWorkspace: () => void;
  readonly onSignOut: () => Promise<void>;
}): ReactNode {
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = () => setMobileOpen(false);
  return (
    <aside className={`sidebar${mobileOpen ? ' mobile-open' : ''}`} aria-label="Navegação principal">
      <div className="sidebar-top">
        <Brand />
        <button
          className="mobile-nav-toggle"
          type="button"
          aria-expanded={mobileOpen}
          aria-controls="primary-navigation"
          aria-label={mobileOpen ? 'Fechar menu' : 'Abrir menu'}
          onClick={() => setMobileOpen((current) => !current)}
        >
          <span /><span /><span />
        </button>
      </div>
      <WorkspaceSwitcher
        workspaces={workspaces}
        activeWorkspace={activeWorkspace}
        busy={workspaceBusy}
        onSelect={onSelectWorkspace}
        onCreateRequested={onCreateWorkspace}
      />
      <nav id="primary-navigation" className="sidebar-navigation">
        <div className="nav-group nav-group-primary">
          <NavLink href={APP_ROUTES.dashboard} active={route === 'dashboard'} onNavigate={closeMobile}>
            <span aria-hidden="true">⌂</span> Dashboard
          </NavLink>
        </div>
        <div className="nav-group">
          <span className="nav-label">Workspace</span>
          <NavLink href={APP_ROUTES.workspaceProjects} active={route === 'workspaceProjects'} onNavigate={closeMobile}>
            <span aria-hidden="true">◇</span> Projetos
          </NavLink>
          <NavLink href={APP_ROUTES.workspaceActivity} active={route === 'workspaceActivity'} onNavigate={closeMobile}>
            <span aria-hidden="true">◷</span> Atividade
          </NavLink>
        </div>
        <div className="nav-group nav-group-settings">
          <NavLink
            href={APP_ROUTES.settingsProfile}
            active={route === 'settingsProfile' || route === 'settingsOrganization'}
            onNavigate={closeMobile}
          >
            <span aria-hidden="true">⚙</span> Configurações
          </NavLink>
        </div>
      </nav>
      <button className="signout" type="button" onClick={() => void onSignOut()}>Sair da conta</button>
    </aside>
  );
}

function PageHeader({ eyebrow, title, description, action }: {
  readonly eyebrow?: string;
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
}): ReactNode {
  return (
    <header className="page-header">
      <div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1><p>{description}</p></div>
      {action}
    </header>
  );
}

function DashboardView({ workspaces, onOpenWorkspace }: {
  readonly workspaces: readonly Workspace[];
  readonly onOpenWorkspace: (workspaceId: string) => Promise<void>;
}): ReactNode {
  const scope = DEFAULT_PORTFOLIO_SCOPE;
  return (
    <>
      <PageHeader
        eyebrow="Visão global"
        title="Dashboard"
        description="Acompanhe sua conta e seus workspaces sem limitar a visão ao contexto ativo."
        action={<span className="scope-pill">{scope.mode === 'ALL_WORKSPACES' ? 'Todos os workspaces' : 'Workspaces selecionados'}</span>}
      />
      <section className="panel portfolio-empty">
        <span className="portfolio-glyph" aria-hidden="true">⌁</span>
        <div>
          <span className="eyebrow">Portfólio</span>
          <h2>Uma visão consolidada está sendo preparada.</h2>
          <p>
            Aqui entrarão indicadores reais de apps, custos, resultados e uso quando esses contratos
            estiverem disponíveis. Nenhuma estimativa ou métrica fictícia é exibida.
          </p>
        </div>
      </section>
      <section className="panel workspace-directory">
        <div className="panel-heading">
          <div><span className="eyebrow">Conta</span><h2>Workspaces disponíveis</h2><p>Abra um contexto para trabalhar nos projetos associados.</p></div>
          <span className="count-pill" aria-label={`${workspaces.length} workspaces`}>{workspaces.length}</span>
        </div>
        <div className="workspace-card-grid">
          {workspaces.map((workspace) => (
            <article className="workspace-card" key={workspace.id}>
              <span className="workspace-kind">{workspace.kind === 'PERSONAL' ? 'Pessoal' : 'Compartilhado'}</span>
              <h3>{workspace.name}</h3>
              <p>{ROLE_LABELS[workspace.role]}</p>
              <button type="button" onClick={() => void onOpenWorkspace(workspace.id)}>Abrir projetos <span aria-hidden="true">→</span></button>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function ProjectsView({ workspace, projects, busy, onCreate, onAction }: {
  readonly workspace: Workspace;
  readonly projects: readonly Project[];
  readonly busy: string | null;
  readonly onCreate: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  readonly onAction: (project: Project, action: 'archive' | 'delete') => Promise<void>;
}): ReactNode {
  const [search, setSearch] = useState('');
  const visibleProjects = useMemo(
    () => projects.filter((project) => projectMatchesSearch(project.name, search)),
    [projects, search],
  );
  const searching = search.trim().length > 0;

  useEffect(() => setSearch(''), [workspace.id]);

  return (
    <>
      <Breadcrumbs items={[{ label: workspace.name }, { label: 'Projetos' }]} />
      <PageHeader title="Projetos" description={`Organize o trabalho operacional de ${workspace.name}.`} />
      <section className="panel projects-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">Workspace atual</span><h2>Seus projetos</h2></div>
          <span className="count-pill" aria-label={searching ? `${visibleProjects.length} de ${projects.length} projetos` : `${projects.length} projetos`}>
            {searching ? `${visibleProjects.length}/${projects.length}` : projects.length}
          </span>
        </div>
        <div className="project-tools">
          <form className="create-project" onSubmit={(event) => void onCreate(event)}>
            <input aria-label="Nome do novo projeto" name="name" placeholder="Nome do novo projeto" required maxLength={120} />
            <button className="button button-primary" disabled={busy === 'project-create'} type="submit">{busy === 'project-create' ? 'Criando…' : '+ Criar projeto'}</button>
          </form>
          <label className="project-search">
            <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
            <input
              type="search"
              aria-label="Buscar projetos"
              placeholder="Buscar projetos"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
        <div className="project-list">
          {projects.length === 0 ? (
            <div className="empty-state"><span>◇</span><h3>Ainda não há projetos</h3><p>Crie o primeiro projeto deste workspace.</p></div>
          ) : visibleProjects.length === 0 ? (
            <div className="empty-state compact"><span aria-hidden="true">⌕</span><h3>Nenhum projeto encontrado</h3><p>Tente buscar por outro nome.</p></div>
          ) : visibleProjects.map((project) => (
            <article className="project-row" key={project.id}>
              <span className="project-glyph" aria-hidden="true">◇</span>
              <div><strong>{project.name}</strong><small>Criado em {new Intl.DateTimeFormat('pt-BR').format(new Date(project.createdAt))}</small></div>
              <span className={`project-status status-${project.status.toLowerCase()}`}>{project.status === 'DRAFT' ? 'Rascunho' : project.status === 'ARCHIVED' ? 'Arquivado' : 'Ativo'}</span>
              <div className="row-actions">
                {project.status !== 'ARCHIVED' && <button type="button" disabled={busy === project.id} onClick={() => void onAction(project, 'archive')}>Arquivar</button>}
                <button className="danger-link" type="button" disabled={busy === project.id} onClick={() => void onAction(project, 'delete')}>Excluir</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function ActivityView({ workspace, events }: { readonly workspace: Workspace; readonly events: readonly AuditEvent[] }): ReactNode {
  return (
    <>
      <Breadcrumbs items={[{ label: workspace.name }, { label: 'Atividade' }]} />
      <PageHeader title="Atividade" description={`Veja as ações recentes realizadas em ${workspace.name}.`} />
      <section className="panel audit-panel">
        <div className="panel-heading"><div><span className="eyebrow">Histórico</span><h2>Atividade recente</h2><p>As operações importantes deste workspace aparecem aqui.</p></div><span className="count-pill">{events.length}</span></div>
        <div className="audit-list">
          {events.length === 0 ? (
            <div className="empty-state compact"><span>◷</span><h3>Nenhuma atividade recente</h3><p>Novas ações aparecerão aqui quando acontecerem.</p></div>
          ) : events.map((event) => (
            <article className="audit-row" key={event.id}>
              <span className="audit-glyph" aria-hidden="true">◷</span>
              <div><strong>{AUDIT_EVENT_LABELS[event.eventCode] ?? 'Atividade do workspace'}</strong><small>{new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(event.occurredAt))}</small></div>
              <span className="audit-outcome">{event.outcome === 'SUCCEEDED' ? 'Concluído' : event.outcome === 'DENIED' ? 'Não realizado' : 'Falhou'}</span>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function SettingsTabs({ active }: { readonly active: 'profile' | 'organization' }): ReactNode {
  return (
    <nav className="settings-tabs" aria-label="Configurações">
      <NavLink href={APP_ROUTES.settingsProfile} active={active === 'profile'} onNavigate={() => undefined}>Perfil</NavLink>
      <NavLink href={APP_ROUTES.settingsOrganization} active={active === 'organization'} onNavigate={() => undefined}>Organização</NavLink>
    </nav>
  );
}

function ProfileSettingsView({ account, busy, notice, onSave }: {
  readonly account: AccountView;
  readonly busy: boolean;
  readonly notice: string | null;
  readonly onSave: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}): ReactNode {
  const profile = account.profile;
  const timezones = [...new Set([profile.timezone, ...COMMON_TIMEZONES])];
  return (
    <>
      <Breadcrumbs items={[{ label: 'Configurações' }, { label: 'Perfil' }]} />
      <PageHeader title="Perfil" description="Atualize seus dados pessoais e preferências de localização." />
      <SettingsTabs active="profile" />
      <section className="panel settings-panel">
        <div className="settings-intro"><div className="profile-avatar">{(profile.displayName || 'GH').slice(0, 2).toUpperCase()}</div><div><h2>Informações pessoais</h2><p>Essas preferências acompanham sua conta no Green Hive.</p></div></div>
        <form key={profile.updatedAt ?? `${profile.displayName}-${profile.timezone}`} className="settings-form" onSubmit={(event) => void onSave(event)}>
          <Field label="Nome" name="displayName" defaultValue={profile.displayName ?? ''} placeholder="Como devemos chamar você?" required maxLength={120} autoComplete="name" />
          <Field label="E-mail" name="email" value={account.email} readOnly disabled type="email" autoComplete="email" hint="O e-mail da conta não pode ser alterado nesta etapa." />
          <div className="form-row">
            <SelectField label="Idioma" name="preferredLocale" defaultValue={profile.preferredLocale} required>
              {LANGUAGE_OPTIONS.map((option) => <option key={option.locale} value={option.locale}>{option.label}</option>)}
            </SelectField>
            <SelectField label="Fuso horário" name="timezone" defaultValue={profile.timezone} required>
              {timezones.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}
            </SelectField>
          </div>
          {notice && <Message kind="success">{notice}</Message>}
          <div className="form-actions"><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar alterações'}</button></div>
        </form>
      </section>
    </>
  );
}

function OrganizationSettingsView({ workspace, busy, notice, onRename }: {
  readonly workspace: Workspace;
  readonly busy: boolean;
  readonly notice: string | null;
  readonly onRename: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}): ReactNode {
  const canRenameShared = workspace.kind === 'SHARED' && (workspace.role === 'OWNER' || workspace.role === 'ADMIN');
  return (
    <>
      <Breadcrumbs items={[{ label: 'Configurações' }, { label: 'Organização' }]} />
      <PageHeader title="Organização" description="Gerencie o nome exibido para o workspace atual." />
      <SettingsTabs active="organization" />
      <section className="panel settings-panel">
        <div className="organization-summary"><span className="organization-mark" aria-hidden="true">⬡</span><div><span>{workspace.kind === 'PERSONAL' ? 'Workspace pessoal' : 'Workspace compartilhado'}</span><h2>{workspace.name}</h2><p>Seu papel: {ROLE_LABELS[workspace.role]}</p></div></div>
        {canRenameShared ? (
          <form key={workspace.name} className="settings-form" onSubmit={(event) => void onRename(event)}>
            <Field label="Nome da organização" name="name" defaultValue={workspace.name} required maxLength={160} autoComplete="organization" hint="A identidade interna do workspace não será alterada." />
            {notice && <Message kind="success">{notice}</Message>}
            <div className="form-actions"><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar nome'}</button></div>
          </form>
        ) : workspace.kind === 'PERSONAL' ? (
          <Message kind="info">O nome inicial deste workspace foi definido no cadastro. A edição posterior do workspace pessoal depende de um comando de renomeação ainda não publicado.</Message>
        ) : (
          <Message kind="info">Somente proprietários e administradores podem alterar o nome desta organização.</Message>
        )}
      </section>
    </>
  );
}

export function AuthenticatedApp({ route }: { readonly route: AppRoute }): ReactNode {
  const [account, setAccount] = useState<AccountView | null>(null);
  const [workspaces, setWorkspaces] = useState<readonly Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [events, setEvents] = useState<readonly AuditEvent[]>([]);
  const [loadingBase, setLoadingBase] = useState(true);
  const [loadingPage, setLoadingPage] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const [workspaceDialogError, setWorkspaceDialogError] = useState<string | null>(null);
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [workspaces, activeWorkspaceId],
  );

  function handleFailure(failure: unknown, fallback: string): void {
    if (failure instanceof ApiFailure && failure.status === 401) go('/auth/sign-in');
    else setError(failure instanceof Error ? failure.message : fallback);
  }

  useEffect(() => {
    let active = true;
    void Promise.all([
      api<AccountView>('/api/me'),
      api<{ workspaces: readonly Workspace[]; activeWorkspaceId: string }>('/api/workspaces'),
    ]).then(([accountView, workspaceList]) => {
      if (!active) return;
      setAccount(accountView);
      setWorkspaces(workspaceList.workspaces);
      setActiveWorkspaceId(workspaceList.activeWorkspaceId);
    }).catch((failure: unknown) => {
      if (active) handleFailure(failure, 'Não foi possível carregar sua conta.');
    }).finally(() => {
      if (active) setLoadingBase(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (loadingBase || !activeWorkspaceId || (route !== 'workspaceProjects' && route !== 'workspaceActivity')) return;
    let active = true;
    setLoadingPage(true);
    setError(null);
    const request = route === 'workspaceProjects'
      ? api<{ projects: readonly Project[] }>('/api/projects').then((result) => { if (active) setProjects(result.projects); })
      : api<{ events: readonly AuditEvent[] }>('/api/audit').then((result) => { if (active) setEvents(result.events); });
    void request.catch((failure: unknown) => {
      if (active) handleFailure(failure, 'Não foi possível carregar este workspace.');
    }).finally(() => { if (active) setLoadingPage(false); });
    return () => { active = false; };
  }, [route, activeWorkspaceId, loadingBase]);

  useEffect(() => {
    setError(null);
    setNotice(null);
  }, [route]);

  async function selectWorkspace(workspaceId: string): Promise<boolean> {
    if (workspaceId === activeWorkspaceId) return true;
    setBusy('workspace-select');
    setError(null);
    setNotice(null);
    try {
      const selected = await api<{ workspace: Workspace }>('/api/workspaces/select', {
        method: 'POST',
        body: JSON.stringify({ organizationId: workspaceId }),
      });
      setActiveWorkspaceId(selected.workspace.id);
      return true;
    } catch (failure) {
      handleFailure(failure, 'Não foi possível trocar o workspace.');
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function openWorkspace(workspaceId: string): Promise<void> {
    if (await selectWorkspace(workspaceId)) go(APP_ROUTES.workspaceProjects);
  }

  async function createWorkspace(name: string): Promise<void> {
    if (busy === 'workspace-create') return;
    setBusy('workspace-create');
    setWorkspaceDialogError(null);
    try {
      const result = await api<{ workspace: Workspace }>('/api/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      setWorkspaces((current) => [...current.filter((workspace) => workspace.id !== result.workspace.id), result.workspace]);
      setActiveWorkspaceId(result.workspace.id);
      setWorkspaceDialogOpen(false);
    } catch (failure) {
      setWorkspaceDialogError(failure instanceof Error ? failure.message : 'Não foi possível criar o workspace.');
    } finally {
      setBusy(null);
    }
  }

  async function createProject(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy('project-create');
    setError(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const result = await api<{ project: Project }>('/api/projects', { method: 'POST', body: JSON.stringify({ name: data.get('name'), metadata: { source: 'reference-app-web' } }) });
      setProjects((current) => [result.project, ...current]);
      form.reset();
    } catch (failure) {
      handleFailure(failure, 'Não foi possível criar o projeto.');
    } finally {
      setBusy(null);
    }
  }

  async function projectAction(project: Project, action: 'archive' | 'delete'): Promise<void> {
    setBusy(project.id);
    setError(null);
    try {
      if (action === 'archive') {
        const result = await api<{ project: Project }>(`/api/projects/${project.id}/archive`, { method: 'POST', body: '{}' });
        setProjects((current) => current.map((item) => item.id === project.id ? result.project : item));
      } else {
        await api(`/api/projects/${project.id}/delete`, { method: 'POST', body: '{}' });
        setProjects((current) => current.filter((item) => item.id !== project.id));
      }
    } catch (failure) {
      handleFailure(failure, 'Não foi possível atualizar o projeto.');
    } finally {
      setBusy(null);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy('profile-save');
    setError(null);
    setNotice(null);
    const data = new FormData(event.currentTarget);
    const preferredLocale = String(data.get('preferredLocale') ?? 'pt-BR');
    try {
      const result = await api<{ profile: Profile }>('/api/me', {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: data.get('displayName'),
          preferredLanguage: languageForLocale(preferredLocale),
          preferredLocale,
          timezone: data.get('timezone'),
        }),
      });
      setAccount((current) => current ? { ...current, profile: result.profile } : current);
      setNotice('Perfil atualizado com sucesso.');
    } catch (failure) {
      handleFailure(failure, 'Não foi possível atualizar o perfil.');
    } finally {
      setBusy(null);
    }
  }

  async function renameOrganization(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy('organization-save');
    setError(null);
    setNotice(null);
    const data = new FormData(event.currentTarget);
    try {
      const result = await api<{ workspace: Workspace }>('/api/workspaces/current', {
        method: 'PATCH',
        body: JSON.stringify({ name: data.get('name') }),
      });
      setWorkspaces((current) => current.map((workspace) => workspace.id === result.workspace.id ? result.workspace : workspace));
      setNotice('Nome da organização atualizado.');
    } catch (failure) {
      handleFailure(failure, 'Não foi possível atualizar a organização.');
    } finally {
      setBusy(null);
    }
  }

  async function signOut(): Promise<void> {
    setBusy('signout');
    try {
      await api('/api/auth/sign-out', { method: 'POST', body: '{}' });
    } finally {
      go('/auth/sign-in');
    }
  }

  return (
    <div className="app-shell">
      <AppSidebar
        route={route}
        workspaces={workspaces}
        activeWorkspace={activeWorkspace}
        workspaceBusy={busy === 'workspace-select'}
        onSelectWorkspace={selectWorkspace}
        onCreateWorkspace={() => { setWorkspaceDialogError(null); setWorkspaceDialogOpen(true); }}
        onSignOut={signOut}
      />
      <main className="app-main" id="main-content">
        {error && <Message>{error}</Message>}
        {loadingBase || !account || !activeWorkspace ? <LoadingPanel /> : (
          <>
            {route === 'dashboard' && <DashboardView workspaces={workspaces} onOpenWorkspace={openWorkspace} />}
            {route === 'workspaceProjects' && (loadingPage ? <LoadingPanel /> : <ProjectsView workspace={activeWorkspace} projects={projects} busy={busy} onCreate={createProject} onAction={projectAction} />)}
            {route === 'workspaceActivity' && (loadingPage ? <LoadingPanel /> : <ActivityView workspace={activeWorkspace} events={events} />)}
            {route === 'settingsProfile' && <ProfileSettingsView account={account} busy={busy === 'profile-save'} notice={notice} onSave={saveProfile} />}
            {route === 'settingsOrganization' && <OrganizationSettingsView workspace={activeWorkspace} busy={busy === 'organization-save'} notice={notice} onRename={renameOrganization} />}
          </>
        )}
      </main>
      <CreateWorkspaceDialog
        open={workspaceDialogOpen}
        busy={busy === 'workspace-create'}
        error={workspaceDialogError}
        onCancel={() => { if (busy !== 'workspace-create') setWorkspaceDialogOpen(false); }}
        onCreate={createWorkspace}
      />
    </div>
  );
}
