import { createElement, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

/** Shared, dependency-light React primitives. Product routing, copy and domain behavior stay with each app. */
export const UI_STATUS = 'GH-0702' as const;

export type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'name'> & {
  readonly label: string;
  readonly name: string;
  readonly hint?: string;
};

export function Field({ label, name, hint, ...input }: FieldProps): ReactNode {
  return createElement('label', { className: 'field' },
    createElement('span', null, label),
    createElement('input', { name, ...input }),
    hint ? createElement('small', null, hint) : null,
  );
}

export type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'name'> & {
  readonly label: string;
  readonly name: string;
  readonly children: ReactNode;
  readonly hint?: string;
};

export function SelectField({ label, name, children, hint, ...select }: SelectFieldProps): ReactNode {
  return createElement('label', { className: 'field' },
    createElement('span', null, label),
    createElement('select', { name, ...select }, children),
    hint ? createElement('small', null, hint) : null,
  );
}

export type MessageKind = 'error' | 'success' | 'info';

export function Message({ children, kind = 'error' }: { readonly children: ReactNode; readonly kind?: MessageKind }): ReactNode {
  return createElement('div', {
    className: `message message-${kind}`,
    role: kind === 'error' ? 'alert' : 'status',
  }, children);
}

export function LoadingPanel({ label }: { readonly label: string }): ReactNode {
  return createElement('div', { className: 'loading-panel', role: 'status', 'aria-live': 'polite' },
    createElement('div', { className: 'spinner', 'aria-hidden': true }),
    createElement('p', null, label),
  );
}
