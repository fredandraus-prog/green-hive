import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

interface ApiErrorPayload {
  readonly error?: { readonly code?: string; readonly message?: string };
}

interface Profile {
  readonly userId: string;
  readonly displayName: string | null;
  readonly preferredLanguage: string;
  readonly preferredLocale: string;
  readonly timezone: string;
}

interface Project {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED' | 'DELETED';
  readonly createdAt: string;
  readonly archivedAt: string | null;
}

interface Workspace {
  readonly id: string;
  readonly name: string;
  readonly kind: 'PERSONAL' | 'SHARED';
  readonly status: 'ACTIVE' | 'ARCHIVED';
  readonly role: 'OWNER' | 'ADMIN' | 'DEVELOPER' | 'ANALYST' | 'VIEWER';
  readonly appRelationship: 'NATIVE' | 'CONNECTED' | 'MIGRATING';
}

interface AuditEvent {
  readonly id: string;
  readonly eventCode: string;
  readonly outcome: 'SUCCEEDED' | 'DENIED' | 'FAILED';
  readonly correlationId: string;
  readonly metadata: Readonly<Record<string, boolean | number | string | null>>;
  readonly occurredAt: string;
}

const AUDIT_EVENT_LABELS: Readonly<Record<string, string>> = {
  ORGANIZATION_CREATED: 'Workspace criado',
  ORGANIZATION_MEMBER_ADDED: 'Membro adicionado',
  ORGANIZATION_MEMBER_CHANGED: 'Membro atualizado',
  ORGANIZATION_APP_INSTALLED: 'Aplicativo instalado',
  PROJECT_CREATED: 'Projeto criado',
  PROJECT_ARCHIVED: 'Projeto arquivado',
  PROJECT_DELETION_REQUESTED: 'Exclusão lógica solicitada',
};

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
  WORKSPACE_ACCESS_DENIED: 'Você não possui acesso a este workspace.',
  WORKSPACE_NOT_FOUND: 'Workspace não encontrado.',
  AUTH_ORGANIZATION_ACCESS_DENIED: 'Sua sessão não possui acesso a este workspace.',
  AUDIT_ACCESS_DENIED: 'Você não possui acesso ao histórico deste workspace.',
  AUDIT_OPERATION_FAILED: 'Não foi possível carregar o histórico de atividades.',
  INTERNAL_ERROR: 'Ocorreu um erro inesperado. Tente novamente.',
};

class ApiFailure extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string) {
    super(FRIENDLY_ERRORS[code] ?? 'Não foi possível concluir esta ação.');
    this.name = 'ApiFailure';
    this.status = status;
    this.code = code;
  }
}

async function api<Result>(path: string, options: RequestInit = {}): Promise<Result> {
  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;
    throw new ApiFailure(response.status, payload.error?.code ?? 'INTERNAL_ERROR');
  }
  if (response.status === 204) return undefined as Result;
  return response.json() as Promise<Result>;
}

function go(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function Brand(): ReactNode {
  return (
    <a
      className="brand"
      href="/"
      onClick={(event) => {
        event.preventDefault();
        go('/');
      }}
      aria-label="Green Hive — página inicial"
    >
      <span className="brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span>
        <strong>Green Hive</strong>
        <small>Reference App</small>
      </span>
    </a>
  );
}

function Shell({ children, compact = false }: { children: ReactNode; compact?: boolean }): ReactNode {
  return (
    <div className={compact ? 'shell shell-compact' : 'shell'}>
      <header className="topbar">
        <Brand />
        <span className="environment-badge">
          <span className="status-dot" /> ambiente local
        </span>
      </header>
      {children}
      <footer>
        <span>Green Hive 0.7</span>
        <span>Autenticação, isolamento e auditoria validados localmente</span>
      </footer>
    </div>
  );
}

function LinkButton({ href, children, tone = 'primary' }: {
  href: string;
  children: ReactNode;
  tone?: 'primary' | 'secondary' | 'quiet';
}): ReactNode {
  return (
    <a
      className={`button button-${tone}`}
      href={href}
      onClick={(event) => {
        event.preventDefault();
        go(href);
      }}
    >
      {children}
    </a>
  );
}

function LandingPage(): ReactNode {
  return (
    <Shell>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">A fundação compartilhada da BeeGreen</span>
            <h1>Uma colmeia segura para cada novo produto.</h1>
            <p>
              Esta aplicação de referência comprova, de ponta a ponta, contas, perfis, projetos e
              workspaces, projetos, isolamento e auditoria segura — antes de conectarmos o
              primeiro MicroSaaS real.
            </p>
            <div className="hero-actions">
              <LinkButton href="/auth/sign-up">Criar conta de teste</LinkButton>
              <LinkButton href="/auth/sign-in" tone="secondary">Já tenho uma conta</LinkButton>
            </div>
            <div className="trust-line">
              <span>✓ Tokens fora do navegador</span>
              <span>✓ RLS por usuário, workspace e app</span>
              <span>✓ Dados somente locais</span>
            </div>
          </div>
          <div className="hive-visual" aria-label="Resumo das camadas validadas">
            <div className="visual-glow" />
            <div className="hive-card hive-card-main">
              <span className="card-kicker">REFERENCE_APP</span>
              <strong>Fluxo local ativo</strong>
              <div className="progress-track"><span /></div>
              <small>Conta → Workspace → App → Projeto → Audit</small>
            </div>
            <div className="hive-card hive-card-auth">
              <span className="mini-icon">◎</span>
              <span><strong>Auth</strong><small>Sessão verificada</small></span>
            </div>
            <div className="hive-card hive-card-projects">
              <span className="mini-icon">◇</span>
              <span><strong>Projetos</strong><small>RLS aplicado</small></span>
            </div>
            <div className="hex-grid" aria-hidden="true">
              {Array.from({ length: 9 }, (_, index) => <span key={index} />)}
            </div>
          </div>
        </section>

        <section className="proof-section">
          <div>
            <span className="eyebrow">O que esta versão prova</span>
            <h2>Uma base pequena, real e verificável.</h2>
          </div>
          <div className="proof-grid">
            <article><span>01</span><h3>Identidade confiável</h3><p>O servidor confirma a sessão e define o app. A tela nunca escolhe privilégios.</p></article>
            <article><span>02</span><h3>Dados isolados</h3><p>Cada pessoa visualiza projetos somente no workspace e app selecionados.</p></article>
            <article><span>03</span><h3>Ciclo de projeto</h3><p>Criação, listagem, arquivamento e exclusão lógica com regras consistentes.</p></article>
          </div>
        </section>
      </main>
    </Shell>
  );
}

function Field({ label, name, type = 'text', autoComplete, placeholder, required = true }: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
}): ReactNode {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required={required}
      />
    </label>
  );
}

function Message({ children, kind = 'error' }: { children: ReactNode; kind?: 'error' | 'success' }): ReactNode {
  return <div className={`message message-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

function AuthPage({ mode }: { mode: 'sign-in' | 'sign-up' }): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signingUp = mode === 'sign-up';

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      await api(signingUp ? '/api/auth/sign-up' : '/api/auth/sign-in', {
        method: 'POST',
        body: JSON.stringify({ email: data.get('email'), password: data.get('password') }),
      });
      go('/app');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível continuar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell compact>
      <main className="auth-layout">
        <section className="auth-intro">
          <span className="eyebrow">Reference App</span>
          <h1>{signingUp ? 'Comece pela sua conta.' : 'Bem-vindo de volta.'}</h1>
          <p>{signingUp ? 'Crie uma identidade local para validar o fluxo completo do Green Hive.' : 'Acesse seu perfil e os projetos isolados da sua conta.'}</p>
          <ul><li>Ambiente totalmente local</li><li>Senha gerenciada pelo Supabase Auth</li><li>Sessão mantida em cookies protegidos</li></ul>
        </section>
        <section className="auth-card">
          <div className="auth-card-heading">
            <span className="step-pill">{signingUp ? 'Nova conta' : 'Acesso seguro'}</span>
            <h2>{signingUp ? 'Criar conta' : 'Entrar'}</h2>
          </div>
          <form onSubmit={(event) => void submit(event)}>
            <Field label="E-mail" name="email" type="email" autoComplete="email" placeholder="voce@exemplo.com" />
            <Field label="Senha" name="password" type="password" autoComplete={signingUp ? 'new-password' : 'current-password'} placeholder="Mínimo de 10 caracteres" />
            {signingUp && <p className="field-hint">Use letras maiúsculas, minúsculas e números.</p>}
            {error && <Message>{error}</Message>}
            <button className="button button-primary button-full" disabled={busy} type="submit">
              {busy ? 'Aguarde…' : signingUp ? 'Criar conta e continuar' : 'Entrar na colmeia'}
            </button>
          </form>
          <div className="auth-links">
            <button type="button" onClick={() => go(signingUp ? '/auth/sign-in' : '/auth/sign-up')}>
              {signingUp ? 'Já possui uma conta? Entrar' : 'Ainda não tem conta? Criar agora'}
            </button>
            {!signingUp && <button type="button" onClick={() => go('/auth/recovery')}>Esqueci minha senha</button>}
          </div>
        </section>
      </main>
    </Shell>
  );
}

function RecoveryPage(): ReactNode {
  const query = new URLSearchParams(window.location.search);
  const hasCode = query.has('code');
  const [stage, setStage] = useState<'request' | 'exchanging' | 'reset' | 'done'>(hasCode ? 'exchanging' : 'request');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exchanged = useRef(false);

  useEffect(() => {
    if (!hasCode || exchanged.current) return;
    exchanged.current = true;
    const code = query.get('code');
    const flowId = query.get('sb_flow_id');
    void api('/api/auth/recovery/exchange', {
      method: 'POST',
      body: JSON.stringify({ code, ...(flowId ? { flowId } : {}) }),
    })
      .then(() => {
        window.history.replaceState({}, '', '/auth/recovery');
        setStage('reset');
      })
      .catch((failure: unknown) => {
        setError(failure instanceof Error ? failure.message : 'Link inválido.');
        setStage('request');
      });
  }, []);

  async function requestRecovery(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      await api('/api/auth/recovery', { method: 'POST', body: JSON.stringify({ email: data.get('email') }) });
      setStage('done');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível continuar.');
    } finally {
      setBusy(false);
    }
  }

  async function updatePassword(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    if (data.get('password') !== data.get('confirmPassword')) {
      setError('As senhas precisam ser iguais.');
      setBusy(false);
      return;
    }
    try {
      await api('/api/auth/recovery/complete', { method: 'POST', body: JSON.stringify({ newPassword: data.get('password') }) });
      go('/app');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível atualizar a senha.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell compact>
      <main className="centered-page">
        <section className="auth-card recovery-card">
          <span className="recovery-icon" aria-hidden="true">↺</span>
          {stage === 'exchanging' && <><h1>Validando seu link…</h1><p>Estamos confirmando a solicitação de recuperação.</p><div className="spinner" /></>}
          {stage === 'request' && <><h1>Recuperar senha</h1><p>Informe o e-mail da conta. No ambiente local, a mensagem aparecerá no Mailpit.</p><form onSubmit={(event) => void requestRecovery(event)}><Field label="E-mail" name="email" type="email" autoComplete="email" />{error && <Message>{error}</Message>}<button className="button button-primary button-full" disabled={busy} type="submit">{busy ? 'Enviando…' : 'Enviar link de recuperação'}</button></form></>}
          {stage === 'done' && <><h1>Confira sua caixa local</h1><p>Se a conta existir, o link de recuperação foi enviado. Abra o Mailpit local para continuar.</p><Message kind="success">Solicitação recebida com segurança.</Message></>}
          {stage === 'reset' && <><h1>Defina uma nova senha</h1><p>O link foi validado. Escolha uma senha forte para concluir.</p><form onSubmit={(event) => void updatePassword(event)}><Field label="Nova senha" name="password" type="password" autoComplete="new-password" /><Field label="Confirmar senha" name="confirmPassword" type="password" autoComplete="new-password" />{error && <Message>{error}</Message>}<button className="button button-primary button-full" disabled={busy} type="submit">{busy ? 'Atualizando…' : 'Salvar nova senha'}</button></form></>}
          <button className="text-link" type="button" onClick={() => go('/auth/sign-in')}>Voltar para o acesso</button>
        </section>
      </main>
    </Shell>
  );
}

function DashboardPage(): ReactNode {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [workspaces, setWorkspaces] = useState<readonly Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [auditEvents, setAuditEvents] = useState<readonly AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      const [me, workspaceList] = await Promise.all([
        api<{ profile: Profile }>('/api/me'),
        api<{ workspaces: readonly Workspace[]; activeWorkspaceId: string }>('/api/workspaces'),
      ]);
      const [projectList, auditList] = await Promise.all([
        api<{ projects: readonly Project[] }>('/api/projects'),
        api<{ events: readonly AuditEvent[] }>('/api/audit'),
      ]);
      setProfile(me.profile);
      setWorkspaces(workspaceList.workspaces);
      setActiveWorkspaceId(workspaceList.activeWorkspaceId);
      setProjects(projectList.projects);
      setAuditEvents(auditList.events);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 401) go('/auth/sign-in');
      else setError(failure instanceof Error ? failure.message : 'Não foi possível carregar os dados.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function selectWorkspace(organizationId: string): Promise<void> {
    setBusy('workspace-select');
    setError(null);
    try {
      const selected = await api<{ workspace: Workspace }>('/api/workspaces/select', {
        method: 'POST',
        body: JSON.stringify({ organizationId }),
      });
      const [projectList, auditList] = await Promise.all([
        api<{ projects: readonly Project[] }>('/api/projects'),
        api<{ events: readonly AuditEvent[] }>('/api/audit'),
      ]);
      setActiveWorkspaceId(selected.workspace.id);
      setProjects(projectList.projects);
      setAuditEvents(auditList.events);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível trocar o workspace.');
    } finally {
      setBusy(null);
    }
  }

  async function createWorkspace(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy('workspace-create');
    setError(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const result = await api<{ workspace: Workspace }>('/api/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name: data.get('name') }),
      });
      setWorkspaces((current) => [...current, result.workspace]);
      setActiveWorkspaceId(result.workspace.id);
      setProjects([]);
      const auditList = await api<{ events: readonly AuditEvent[] }>('/api/audit');
      setAuditEvents(auditList.events);
      form.reset();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível criar o workspace.');
    } finally {
      setBusy(null);
    }
  }

  async function createProject(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy('create');
    setError(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const result = await api<{ project: Project }>('/api/projects', { method: 'POST', body: JSON.stringify({ name: data.get('name'), metadata: { source: 'reference-app-web' } }) });
      setProjects((current) => [result.project, ...current]);
      const auditList = await api<{ events: readonly AuditEvent[] }>('/api/audit');
      setAuditEvents(auditList.events);
      form.reset();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível criar o projeto.');
    } finally {
      setBusy(null);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy('profile');
    const data = new FormData(event.currentTarget);
    try {
      const result = await api<{ profile: Profile }>('/api/me', { method: 'PATCH', body: JSON.stringify({ displayName: data.get('displayName'), preferredLanguage: 'pt', preferredLocale: 'pt-BR', timezone: 'America/Sao_Paulo' }) });
      setProfile(result.profile);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível atualizar o perfil.');
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
      const auditList = await api<{ events: readonly AuditEvent[] }>('/api/audit');
      setAuditEvents(auditList.events);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível atualizar o projeto.');
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
      <aside className="sidebar">
        <Brand />
        <nav><a className="active" href="/app">Visão geral</a><a href="#projects">Projetos</a><a href="#activity">Atividade</a><a href="#profile">Meu perfil</a></nav>
        <label className="workspace-switcher">
          <span>Workspace ativo</span>
          <select
            aria-label="Workspace ativo"
            disabled={busy === 'workspace-select'}
            value={activeWorkspaceId ?? ''}
            onChange={(event) => void selectWorkspace(event.target.value)}
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
          <small>Escopo validado pelo servidor</small>
        </label>
        <div className="sidebar-proof"><span className="status-dot" /><div><strong>Proteção ativa</strong><small>Auth + RLS + cookies</small></div></div>
        <button className="signout" type="button" onClick={() => void signOut()} disabled={busy === 'signout'}>Sair da conta</button>
      </aside>
      <main className="dashboard">
        <header className="dashboard-header"><div><span className="eyebrow">Visão geral</span><h1>Olá, {profile?.displayName || 'explorador'}.</h1><p>Acompanhe o fluxo real da plataforma neste ambiente local.</p></div><span className="environment-badge"><span className="status-dot" /> todos os serviços ativos</span></header>
        {error && <Message>{error}</Message>}
        {loading ? <div className="loading-panel"><div className="spinner" /><p>Carregando sua colmeia…</p></div> : <>
          <section className="stats-grid"><article><span>Projetos visíveis</span><strong>{projects.length}</strong><small>Somente deste workspace e app</small></article><article><span>Workspaces</span><strong>{workspaces.length}</strong><small>Pessoal e compartilhados</small></article><article><span>Isolamento</span><strong className="small-value">RLS ativo</strong><small>Usuário + workspace + app</small></article></section>
          <section className="workspace-panel panel">
            <div><span className="eyebrow">Organizations Foundation</span><h2>{workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.name ?? 'Workspace'}</h2><p>O workspace selecionado define o limite dos projetos exibidos abaixo.</p></div>
            <form onSubmit={(event) => void createWorkspace(event)}><input aria-label="Nome do workspace compartilhado" name="name" placeholder="Novo workspace compartilhado" required maxLength={160} /><button className="button button-secondary" disabled={busy === 'workspace-create'} type="submit">{busy === 'workspace-create' ? 'Criando…' : '+ Criar workspace'}</button></form>
          </section>
          <section className="dashboard-grid">
            <div className="panel projects-panel" id="projects"><div className="panel-heading"><div><span className="eyebrow">Project Service</span><h2>Seus projetos</h2></div><span className="count-pill">{projects.length}</span></div><form className="create-project" onSubmit={(event) => void createProject(event)}><input aria-label="Nome do novo projeto" name="name" placeholder="Nome do novo projeto" required maxLength={120} /><button className="button button-primary" disabled={busy === 'create'} type="submit">{busy === 'create' ? 'Criando…' : '+ Criar projeto'}</button></form><div className="project-list">{projects.length === 0 ? <div className="empty-state"><span>◇</span><h3>Ainda não há projetos</h3><p>Crie o primeiro para validar o escopo da sua conta.</p></div> : projects.map((project) => <article className="project-row" key={project.id}><span className="project-glyph">◇</span><div><strong>{project.name}</strong><small>Criado em {new Intl.DateTimeFormat('pt-BR').format(new Date(project.createdAt))}</small></div><span className={`project-status status-${project.status.toLowerCase()}`}>{project.status === 'DRAFT' ? 'Rascunho' : project.status === 'ARCHIVED' ? 'Arquivado' : 'Ativo'}</span><div className="row-actions">{project.status !== 'ARCHIVED' && <button type="button" disabled={busy === project.id} onClick={() => void projectAction(project, 'archive')}>Arquivar</button>}<button className="danger-link" type="button" disabled={busy === project.id} onClick={() => void projectAction(project, 'delete')}>Excluir</button></div></article>)}</div></div>
            <div className="panel profile-panel" id="profile"><div className="profile-avatar">{(profile?.displayName || 'GH').slice(0, 2).toUpperCase()}</div><span className="eyebrow">Conta protegida</span><h2>Meu perfil</h2><p>Preferências compartilhadas entre produtos BeeGreen.</p><form onSubmit={(event) => void saveProfile(event)}><Field label="Nome de exibição" name="displayName" placeholder="Como devemos chamar você?" required={false} /><div className="profile-detail"><span>Idioma</span><strong>Português</strong></div><div className="profile-detail"><span>Fuso horário</span><strong>São Paulo</strong></div><button className="button button-secondary button-full" disabled={busy === 'profile'} type="submit">{busy === 'profile' ? 'Salvando…' : 'Salvar perfil'}</button></form></div>
          </section>
          <section className="panel audit-panel" id="activity">
            <div className="panel-heading"><div><span className="eyebrow">Audit Foundation</span><h2>Atividade recente</h2><p>Eventos operacionais seguros deste workspace e aplicativo.</p></div><span className="count-pill">{auditEvents.length}</span></div>
            <div className="audit-list">
              {auditEvents.length === 0 ? <div className="empty-state compact"><span>◎</span><h3>Nenhum evento registrado</h3><p>As próximas operações importantes aparecerão aqui.</p></div> : auditEvents.map((event) => <article className="audit-row" key={event.id}><span className="audit-glyph" aria-hidden="true">◎</span><div><strong>{AUDIT_EVENT_LABELS[event.eventCode] ?? event.eventCode}</strong><small>{new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(event.occurredAt))}</small></div><span className="audit-outcome">{event.outcome === 'SUCCEEDED' ? 'Concluído' : event.outcome}</span></article>)}
            </div>
          </section>
        </>}
      </main>
    </div>
  );
}

function App(): ReactNode {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  if (path === '/auth/sign-in') return <AuthPage mode="sign-in" />;
  if (path === '/auth/sign-up') return <AuthPage mode="sign-up" />;
  if (path === '/auth/recovery') return <RecoveryPage />;
  if (path === '/app') return <DashboardPage />;
  return <LandingPage />;
}

const root = document.getElementById('root');
if (!root) throw new Error('Reference App root element was not found');
createRoot(root).render(<App />);
