import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import enUS from "@solyx/i18n/desktop/en-US.json";
import zhTW from "@solyx/i18n/desktop/zh-TW.json";

import { Locale, localeSchema } from "#shared/ipc/settings.ts";

import { storageKey } from "./persist.ts";

const LOCALE_STORAGE_KEY = storageKey("locale");

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

/** The language the app is showing; i18next only ever switches to a `Locale`. */
export function currentLocale(): Locale {
  return localeSchema.parse(i18next.language);
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
