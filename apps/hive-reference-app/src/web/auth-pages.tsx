import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api } from './api.js';
import {
  COMMON_TIMEZONES,
  detectInitialPreferences,
  go,
  languageForLocale,
  LANGUAGE_OPTIONS,
} from '../frontend-contracts.js';
import { Field, MarketingShell, Message, SelectField } from './ui.js';

interface AccountDraft {
  readonly displayName: string;
  readonly email: string;
  readonly password: string;
}

function browserDefaults() {
  const locales = typeof navigator === 'undefined' ? [] : navigator.languages;
  let timezone: string | undefined;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    timezone = undefined;
  }
  return detectInitialPreferences(locales, timezone);
}

export function AuthPage({ mode }: { readonly mode: 'sign-in' | 'sign-up' }): ReactNode {
  const signingUp = mode === 'sign-up';
  const [step, setStep] = useState<1 | 2>(1);
  const [draft, setDraft] = useState<AccountDraft>({ displayName: '', email: '', password: '' });
  const [preferences] = useState(browserDefaults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timezones = [...new Set([preferences.timezone, ...COMMON_TIMEZONES])];

  function continueSignup(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setDraft({
      displayName: String(data.get('displayName') ?? '').trim(),
      email: String(data.get('email') ?? '').trim(),
      password: String(data.get('password') ?? ''),
    });
    setError(null);
    setStep(2);
  }

  async function signIn(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      await api('/api/auth/sign-in', {
        method: 'POST',
        body: JSON.stringify({ email: data.get('email'), password: data.get('password') }),
      });
      go('/app/dashboard');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível continuar.');
    } finally {
      setBusy(false);
    }
  }

  async function finishSignup(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    const preferredLocale = String(data.get('preferredLocale') ?? preferences.locale);
    try {
      await api('/api/auth/sign-up', {
        method: 'POST',
        body: JSON.stringify({
          ...draft,
          preferredLanguage: languageForLocale(preferredLocale),
          preferredLocale,
          timezone: data.get('timezone'),
          organizationName: data.get('organizationName'),
        }),
      });
      go('/app/dashboard');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível criar a conta.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <MarketingShell compact>
      <main className="auth-layout">
        <section className="auth-intro">
          <span className="eyebrow">Green Hive</span>
          <h1>{signingUp ? 'Prepare seu primeiro workspace.' : 'Bem-vindo de volta.'}</h1>
          <p>{signingUp
            ? 'Crie sua conta e escolha as preferências iniciais em dois passos rápidos.'
            : 'Acesse seus workspaces, projetos e configurações pessoais.'}</p>
          <ul>
            <li>Seu espaço pessoal começa pronto</li>
            <li>Preferências acompanham sua conta</li>
            <li>Novos workspaces ficam a poucos cliques</li>
          </ul>
        </section>
        <section className="auth-card">
          {signingUp && (
            <ol className="onboarding-progress" aria-label="Etapas do cadastro">
              <li className={step === 1 ? 'active' : 'done'} aria-current={step === 1 ? 'step' : undefined}><span>1</span> Conta</li>
              <li className={step === 2 ? 'active' : ''} aria-current={step === 2 ? 'step' : undefined}><span>2</span> Configuração</li>
            </ol>
          )}
          <div className="auth-card-heading">
            <span className="step-pill">{signingUp ? (step === 1 ? 'Etapa 1 de 2' : 'Etapa 2 de 2') : 'Acesso'}</span>
            <h2>{signingUp ? (step === 1 ? 'Crie sua conta' : 'Configure seu espaço') : 'Entrar'}</h2>
          </div>

          {!signingUp && (
            <form onSubmit={(event) => void signIn(event)}>
              <Field label="E-mail" name="email" type="email" autoComplete="email" placeholder="voce@exemplo.com" required />
              <Field label="Senha" name="password" type="password" autoComplete="current-password" placeholder="Sua senha" required />
              {error && <Message>{error}</Message>}
              <button className="button button-primary button-full" disabled={busy} type="submit">{busy ? 'Aguarde…' : 'Entrar'}</button>
            </form>
          )}

          {signingUp && step === 1 && (
            <form onSubmit={continueSignup}>
              <Field label="Nome" name="displayName" autoComplete="name" placeholder="Como devemos chamar você?" defaultValue={draft.displayName} required maxLength={120} />
              <Field label="E-mail" name="email" type="email" autoComplete="email" placeholder="voce@exemplo.com" defaultValue={draft.email} required />
              <Field label="Senha" name="password" type="password" autoComplete="new-password" placeholder="Mínimo de 10 caracteres" defaultValue={draft.password} required minLength={10} maxLength={128} hint="Use letras maiúsculas, minúsculas e números." />
              <button className="button button-primary button-full" type="submit">Continuar</button>
            </form>
          )}

          {signingUp && step === 2 && (
            <form onSubmit={(event) => void finishSignup(event)}>
              <SelectField label="Idioma" name="preferredLocale" defaultValue={preferences.locale} required>
                {LANGUAGE_OPTIONS.map((option) => <option key={option.locale} value={option.locale}>{option.label}</option>)}
              </SelectField>
              <SelectField label="Fuso horário" name="timezone" defaultValue={preferences.timezone} required>
                {timezones.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}
              </SelectField>
              <Field label="Nome da organização" name="organizationName" autoComplete="organization" placeholder="Ex.: Minha Empresa" required maxLength={160} hint="Este será o nome inicial do seu workspace pessoal." />
              {error && <Message>{error}</Message>}
              <div className="onboarding-actions">
                <button className="button button-quiet" type="button" disabled={busy} onClick={() => setStep(1)}>Voltar</button>
                <button className="button button-primary" disabled={busy} type="submit">{busy ? 'Criando…' : 'Criar conta'}</button>
              </div>
            </form>
          )}

          <div className="auth-links">
            <button type="button" onClick={() => go(signingUp ? '/auth/sign-in' : '/auth/sign-up')}>
              {signingUp ? 'Já possui uma conta? Entrar' : 'Ainda não tem conta? Criar agora'}
            </button>
            {!signingUp && <button type="button" onClick={() => go('/auth/recovery')}>Esqueci minha senha</button>}
          </div>
        </section>
      </main>
    </MarketingShell>
  );
}

export function RecoveryPage(): ReactNode {
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
    }).then(() => {
      window.history.replaceState({}, '', '/auth/recovery');
      setStage('reset');
    }).catch((failure: unknown) => {
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
      go('/app/dashboard');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível atualizar a senha.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <MarketingShell compact>
      <main className="centered-page">
        <section className="auth-card recovery-card">
          <span className="recovery-icon" aria-hidden="true">↺</span>
          {stage === 'exchanging' && <><h1>Validando seu link…</h1><p>Estamos confirmando a solicitação de recuperação.</p><div className="spinner" /></>}
          {stage === 'request' && <><h1>Recuperar senha</h1><p>Informe o e-mail da sua conta para receber o link de recuperação.</p><form onSubmit={(event) => void requestRecovery(event)}><Field label="E-mail" name="email" type="email" autoComplete="email" required />{error && <Message>{error}</Message>}<button className="button button-primary button-full" disabled={busy} type="submit">{busy ? 'Enviando…' : 'Enviar link'}</button></form></>}
          {stage === 'done' && <><h1>Confira sua caixa de entrada</h1><p>Se a conta existir, enviaremos as instruções para o e-mail informado.</p><Message kind="success">Solicitação recebida.</Message></>}
          {stage === 'reset' && <><h1>Defina uma nova senha</h1><p>Escolha uma senha forte para concluir.</p><form onSubmit={(event) => void updatePassword(event)}><Field label="Nova senha" name="password" type="password" autoComplete="new-password" required /><Field label="Confirmar senha" name="confirmPassword" type="password" autoComplete="new-password" required />{error && <Message>{error}</Message>}<button className="button button-primary button-full" disabled={busy} type="submit">{busy ? 'Atualizando…' : 'Salvar nova senha'}</button></form></>}
          <button className="text-link" type="button" onClick={() => go('/auth/sign-in')}>Voltar para o acesso</button>
        </section>
      </main>
    </MarketingShell>
  );
}
