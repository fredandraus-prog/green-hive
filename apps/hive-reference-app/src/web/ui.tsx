import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';
import { go } from '../frontend-contracts.js';

export function Brand(): ReactNode {
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
      <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
      <span><strong>Green Hive</strong><small>Reference App</small></span>
    </a>
  );
}

export function MarketingShell({ children, compact = false }: {
  readonly children: ReactNode;
  readonly compact?: boolean;
}): ReactNode {
  return (
    <div className={compact ? 'shell shell-compact' : 'shell'}>
      <header className="topbar">
        <Brand />
        <span className="product-badge">Plataforma Green Hive</span>
      </header>
      {children}
      <footer>
        <span>Green Hive 0.7</span>
        <span>Workspaces, projetos e preferências em um só lugar</span>
      </footer>
    </div>
  );
}

export function LinkButton({ href, children, tone = 'primary' }: {
  readonly href: string;
  readonly children: ReactNode;
  readonly tone?: 'primary' | 'secondary' | 'quiet';
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

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'name'> & {
  readonly label: string;
  readonly name: string;
  readonly hint?: string;
};

export function Field({ label, name, hint, ...input }: FieldProps): ReactNode {
  return (
    <label className="field">
      <span>{label}</span>
      <input name={name} {...input} />
      {hint && <small>{hint}</small>}
    </label>
  );
}

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'name'> & {
  readonly label: string;
  readonly name: string;
  readonly children: ReactNode;
  readonly hint?: string;
};

export function SelectField({ label, name, children, hint, ...select }: SelectFieldProps): ReactNode {
  return (
    <label className="field">
      <span>{label}</span>
      <select name={name} {...select}>{children}</select>
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Message({ children, kind = 'error' }: {
  readonly children: ReactNode;
  readonly kind?: 'error' | 'success' | 'info';
}): ReactNode {
  return (
    <div className={`message message-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Breadcrumbs({ items }: {
  readonly items: readonly { readonly label: string; readonly href?: string }[];
}): ReactNode {
  return (
    <nav className="breadcrumbs" aria-label="Navegação estrutural">
      <ol>
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            {item.href ? (
              <a href={item.href} onClick={(event) => { event.preventDefault(); go(item.href ?? '/app'); }}>
                {item.label}
              </a>
            ) : <span aria-current="page">{item.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function LoadingPanel(): ReactNode {
  return <div className="loading-panel"><div className="spinner" /><p>Carregando seu espaço…</p></div>;
}

export function LandingPage(): ReactNode {
  return (
    <MarketingShell>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">A plataforma compartilhada da BeeGreen</span>
            <h1>Organize seus produtos a partir de um só lugar.</h1>
            <p>
              Reúna workspaces, projetos e preferências em uma experiência simples, pronta para
              acompanhar a evolução de novos apps.
            </p>
            <div className="hero-actions">
              <LinkButton href="/auth/sign-up">Criar minha conta</LinkButton>
              <LinkButton href="/auth/sign-in" tone="secondary">Já tenho uma conta</LinkButton>
            </div>
            <div className="trust-line">
              <span>✓ Conta pessoal</span>
              <span>✓ Workspaces organizados</span>
              <span>✓ Projetos em contexto</span>
            </div>
          </div>
          <div className="hive-visual" aria-label="Visão do portfólio Green Hive">
            <div className="visual-glow" />
            <div className="hive-card hive-card-main">
              <span className="card-kicker">SEU PORTFÓLIO</span>
              <strong>Um ponto de partida claro</strong>
              <div className="progress-track"><span /></div>
              <small>Conta → Workspace → Apps → Projetos</small>
            </div>
            <div className="hive-card hive-card-auth">
              <span className="mini-icon">◎</span>
              <span><strong>Conta</strong><small>Preferências pessoais</small></span>
            </div>
            <div className="hive-card hive-card-projects">
              <span className="mini-icon">◇</span>
              <span><strong>Projetos</strong><small>Organizados por workspace</small></span>
            </div>
            <div className="hex-grid" aria-hidden="true">
              {Array.from({ length: 9 }, (_, index) => <span key={index} />)}
            </div>
          </div>
        </section>
        <section className="proof-section">
          <div><span className="eyebrow">Uma base que cresce com você</span><h2>Comece pequeno, sem perder a visão do todo.</h2></div>
          <div className="proof-grid">
            <article><span>01</span><h3>Conta e preferências</h3><p>Mantenha seu nome, idioma e fuso horário associados à sua conta.</p></article>
            <article><span>02</span><h3>Workspaces</h3><p>Separe contextos de trabalho e alterne entre eles quando precisar.</p></article>
            <article><span>03</span><h3>Projetos</h3><p>Crie, acompanhe e arquive projetos dentro do contexto correto.</p></article>
          </div>
        </section>
      </main>
    </MarketingShell>
  );
}
