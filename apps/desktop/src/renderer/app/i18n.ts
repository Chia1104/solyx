import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as z from "zod";

import enUS from "@solyx/i18n/desktop/en-US.json";
import zhTW from "@solyx/i18n/desktop/zh-TW.json";

export const Locale = {
  EnUS: "en-US",
  ZhTW: "zh-TW",
} as const;

export type Locale = (typeof Locale)[keyof typeof Locale];

export const localeSchema = z.enum(Locale);

const LOCALE_STORAGE_KEY = "solyx.locale";

function initialLocale(): Locale {
  const stored = localeSchema.safeParse(
    localStorage.getItem(LOCALE_STORAGE_KEY)
  );

  if (stored.success) return stored.data;

  // zh-TW is the only Chinese catalog, so every Chinese system locale lands on it.
  return navigator.language.toLowerCase().startsWith("zh")
    ? Locale.ZhTW
    : Locale.EnUS;
}

export function changeLocale(locale: Locale) {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);

  return i18next.changeLanguage(locale);
}

i18next.on("languageChanged", (locale) => {
  document.documentElement.lang = locale;
});

// Catalogs are bundled, so initialize synchronously and render without a Suspense fallback.
void i18next.use(initReactI18next).init({
  resources: {
    [Locale.EnUS]: { translation: enUS },
    [Locale.ZhTW]: { translation: zhTW },
  },
  lng: initialLocale(),
  fallbackLng: Locale.EnUS,
  initAsync: false,
  interpolation: { escapeValue: false },
});

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof enUS };
  }
}
