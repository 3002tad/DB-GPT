import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { translateDynamicVi, viUiText } from '@/locales/vi/ui-text';

/** For localized built-in UI copy whose Chinese and English forms are adjacent. */
export function useUiText() {
  const { i18n } = useTranslation();
  const language = i18n?.resolvedLanguage || i18n?.language || 'en';
  return useCallback((zh: string, en: string) => {
    const locale = language.toLowerCase();
    if (locale.startsWith('zh')) return zh;
    if (locale.startsWith('vi')) return viUiText[en] ?? translateDynamicVi(en) ?? en;
    return en;
  }, [language]);
}
