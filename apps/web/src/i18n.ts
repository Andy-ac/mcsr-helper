import { LOCALES, type Locale } from '@mcsr/shared';
import { resources } from '@mcsr/shared/i18n';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const STORAGE_KEY = 'mcsr.locale';

function detectLocale(): Locale {
  const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
  if (stored && (LOCALES as readonly string[]).includes(stored)) return stored as Locale;

  const nav = globalThis.navigator?.language ?? '';
  return nav.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export const initialLocale = detectLocale();

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLocale,
  fallbackLng: 'zh-CN',
  supportedLngs: LOCALES,
  interpolation: { escapeValue: false }, // React 自身已做转义
  returnNull: false,
});

export function setLocale(next: Locale) {
  globalThis.localStorage?.setItem(STORAGE_KEY, next);
  void i18n.changeLanguage(next);
  document.documentElement.lang = next;
}

document.documentElement.lang = initialLocale;

export default i18n;
