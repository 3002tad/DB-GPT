import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

/** For localized built-in UI copy whose Chinese and English forms are adjacent. */
export function useUiText() {
  const { i18n } = useTranslation();
  const language = i18n?.resolvedLanguage || i18n?.language || 'en';
  return useCallback((zh: string, en: string) => (language.toLowerCase().startsWith('zh') ? zh : en), [language]);
}
