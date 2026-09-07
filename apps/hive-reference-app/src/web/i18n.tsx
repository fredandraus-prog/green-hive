import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  createTranslator,
  DEFAULT_LOCALE,
  resolveLocale,
  type SupportedLocale,
  type Translator,
} from '@green-hive/i18n';

interface I18nContextValue extends Translator {
  readonly setLocale: (locale: unknown) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function browserLocale(): SupportedLocale {
  return resolveLocale(typeof navigator === 'undefined' ? [] : navigator.languages);
}

export function I18nProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const [locale, setLocale] = useState<SupportedLocale>(browserLocale);
  const value = useMemo<I18nContextValue>(() => ({ ...createTranslator(locale), setLocale: (next) => setLocale(resolveLocale(next)) }), [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error('I18nProvider is required for the Reference App');
  return context;
}

export const INITIAL_REFERENCE_APP_LOCALE = DEFAULT_LOCALE;
