import i18next from 'i18next';
import dashboardEn from '@/locales/en/dashboard';
import { translateDynamicVi, viUiText } from '@/locales/vi/ui-text';
import { useTranslation } from 'react-i18next';

/**
 * UI copy only. Dashboard titles, query results and persisted schema values are
 * user content and must not be passed through this translator.
 * Chinese source strings are the stable keys in the dashboard namespace.
 */
export function dashboardText(text: string, values: Record<string, unknown> = {}): string {
  const fallback = () =>
    text.replace(/\{\{\s*(\w+)\s*\}\}/g, (token, key: string) =>
      values[key] === undefined ? token : String(values[key]),
    );
  if (!i18next.isInitialized) return fallback();
  if ((i18next.resolvedLanguage || i18next.language || '').startsWith('vi')) {
    const english = dashboardEn[text] || text;
    const rendered = english.replace(/\{\{\s*(\w+)\s*\}\}/g, (token, key: string) =>
      values[key] === undefined ? token : String(values[key]),
    );
    const translated = viUiText[english] || viUiText[rendered] || translateDynamicVi(rendered) || rendered;
    return translated.replace(/\{\{\s*(\w+)\s*\}\}/g, (token, key: string) =>
      values[key] === undefined ? token : String(values[key]),
    );
  }
  return String(
    i18next.t(text, {
      ...values,
      ns: 'dashboard',
      keySeparator: false,
      nsSeparator: false,
      defaultValue: fallback(),
    }),
  );
}

/** Subscribe to the site's language switch without remounting or losing drafts. */
export function useDashboardTranslation() {
  const { i18n } = useTranslation('dashboard', { i18n: i18next, useSuspense: false });
  return i18n.resolvedLanguage || i18n.language || 'zh';
}

export function dashboardDateLocale() {
  return i18next.language?.toLowerCase().startsWith('vi') ? 'vi-VN' : i18next.language?.toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN';
}
