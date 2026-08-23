import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { Workspace } from './types.js';
import { Field, Message } from './ui.js';

export function WorkspaceSwitcher({ workspaces, activeWorkspace, busy, onSelect, onCreateRequested }: {
  readonly workspaces: readonly Workspace[];
  readonly activeWorkspace: Workspace | null;
  readonly busy: boolean;
  readonly onSelect: (workspaceId: string) => Promise<boolean>;
  readonly onCreateRequested: () => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOutside);
    return () => document.removeEventListener('mousedown', closeOutside);
  }, [open]);

  function focusItem(position: 'first' | 'last'): void {
    requestAnimationFrame(() => {
      const items = root.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]');
      const item = position === 'first' ? items?.[0] : items?.[items.length - 1];
      item?.focus();
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const items = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? [])];
    const currentIndex = items.findIndex((item) => item === document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    if (!open) {
      setOpen(true);
      focusItem(event.key === 'ArrowUp' || event.key === 'End' ? 'last' : 'first');
      return;
    }
    if (items.length === 0) return;
    if (event.key === 'Home') items[0]?.focus();
    else if (event.key === 'End') items[items.length - 1]?.focus();
    else {
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = currentIndex < 0
        ? (direction === 1 ? 0 : items.length - 1)
        : (currentIndex + direction + items.length) % items.length;
      items[nextIndex]?.focus();
    }
  }

  return (
    <div className="workspace-switcher" ref={root} onKeyDown={handleKeyDown}>
      <button
        ref={trigger}
        className="workspace-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="workspace-menu"
        disabled={busy || workspaces.length === 0}
        onClick={() => setOpen((current) => !current)}
      >
        <span><small>Workspace atual</small><strong>{activeWorkspace?.name ?? 'Carregando…'}</strong></span>
        <span className="chevron" aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="workspace-menu" id="workspace-menu" role="menu" aria-label="Selecionar workspace">
          <span className="menu-label">Seus workspaces</span>
          {workspaces.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              role="menuitemradio"
              aria-checked={workspace.id === activeWorkspace?.id}
              onClick={() => {
                setOpen(false);
                void onSelect(workspace.id);
              }}
            >
              <span>{workspace.name}<small>{workspace.kind === 'PERSONAL' ? 'Pessoal' : 'Compartilhado'}</small></span>
              {workspace.id === activeWorkspace?.id && <span aria-hidden="true">✓</span>}
            </button>
          ))}
          <div className="menu-separator" role="separator" />
          <button
            className="workspace-create-action"
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onCreateRequested();
            }}
          >
            <span aria-hidden="true">＋</span> Criar workspace
          </button>
        </div>
      )}
    </div>
  );
}

export function CreateWorkspaceDialog({ open, busy, error, onCancel, onCreate }: {
  readonly open: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onCreate: (name: string) => Promise<void>;
}): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const [validation, setValidation] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setValidation(null);
      element.showModal();
      requestAnimationFrame(() => element.querySelector<HTMLInputElement>('input')?.focus());
    } else if (!open && element.open) element.close();
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
    if (name.length < 1 || name.length > 160) {
      setValidation('Informe um nome entre 1 e 160 caracteres.');
      return;
    }
    setValidation(null);
    await onCreate(name);
  }

  return (
    <dialog
      className="workspace-dialog"
      ref={dialog}
      aria-labelledby="create-workspace-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <form onSubmit={(event) => void submit(event)}>
        <div className="dialog-heading">
          <span className="dialog-icon" aria-hidden="true">＋</span>
          <div><span className="eyebrow">Novo contexto</span><h2 id="create-workspace-title">Criar workspace</h2></div>
        </div>
        <p>Use um nome que ajude sua equipe a reconhecer este espaço.</p>
        <Field label="Nome" name="name" placeholder="Ex.: Produto principal" required maxLength={160} autoComplete="organization" />
        {(validation || error) && <Message>{validation ?? error}</Message>}
        <div className="dialog-actions">
          <button className="button button-quiet" type="button" disabled={busy} onClick={onCancel}>Cancelar</button>
          <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Criando…' : 'Criar'}</button>
        </div>
      </form>
    </dialog>
  );
}
