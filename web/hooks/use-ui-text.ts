import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { translateDynamicVi, viUiText } from '@/locales/vi/ui-text';

/** For localized built-in UI copy whose Chinese and English forms are adjacent. */
export function uiText(language: string, zh: string | null | undefined, en: string | null | undefined): string {
  const locale = language.toLowerCase();
  if (locale.startsWith('zh')) return zh || en || '';
  const english = en || zh || '';
  if (locale.startsWith('vi')) return viUiText[english] ?? translateDynamicVi(english) ?? english;
  return english;
}

export function useUiText() {
  const { i18n } = useTranslation();
  const language = i18n?.resolvedLanguage || i18n?.language || 'en';
  return useCallback((zh: string | null | undefined, en: string | null | undefined) => {
    return uiText(language, zh, en);
  }, [language]);
}
