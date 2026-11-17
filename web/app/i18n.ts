import en from '@/locales/en';
import dashboardEn from '@/locales/en/dashboard';
import zh from '@/locales/zh';
import vi from '@/locales/vi';
import dashboardVi from '@/locales/vi/dashboard';
import dashboardZh from '@/locales/zh/dashboard';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export type I18nKeys = keyof typeof en;
interface Resources {
  translation: Record<I18nKeys, string>;
  dashboard: Record<string, string>;
}

i18n.use(initReactI18next).init({
  resources: {
    vi: { translation: vi, dashboard: dashboardVi },
    en: {
      translation: en,
      dashboard: dashboardEn,
    },
    zh: {
      translation: zh,
      dashboard: dashboardZh,
    },
  },
  lng: 'vi',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;

declare module 'i18next' {
  interface CustomTypeOptions {
    resources: Resources;
  }
}
