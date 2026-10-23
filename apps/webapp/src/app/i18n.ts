import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import {
  LanguagePreference,
  Locale,
  localeSchema,
  resolveLocale,
} from "@solyx/api/settings";
import enUS from "@solyx/i18n/desktop/en-US.json";
import zhTW from "@solyx/i18n/desktop/zh-TW.json";

/** The language the app is showing; i18next only ever switches to a `Locale`. */
export function currentLocale(): Locale {
  return localeSchema.parse(i18next.language);
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
  // The computer's language until `followLanguage` has the saved one, before anything renders.
  lng: resolveLocale(LanguagePreference.System, navigator.language),
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
