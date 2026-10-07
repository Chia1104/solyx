import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as z from "zod";

import enUS from "@solyx/i18n/desktop/en-US.json";
import zhTW from "@solyx/i18n/desktop/zh-TW.json";

import { Locale, localeSchema } from "#shared/ipc/settings.ts";

import { storageKey } from "./persist.ts";

const LANGUAGE_STORAGE_KEY = storageKey("locale");

/** The language the user picked: a catalog, or `system` to follow the computer's language. */
export const LanguagePreference = { System: "system", ...Locale } as const;

export type LanguagePreference =
  (typeof LanguagePreference)[keyof typeof LanguagePreference];

const languagePreferenceSchema = z.enum(LanguagePreference);

/** The saved preference; until the user picks one, the app follows the computer. */
export function languagePreference(): LanguagePreference {
  const saved = languagePreferenceSchema.safeParse(
    localStorage.getItem(LANGUAGE_STORAGE_KEY)
  );

  return saved.success ? saved.data : LanguagePreference.System;
}

function resolveLocale(preference: LanguagePreference): Locale {
  if (preference !== LanguagePreference.System) return preference;

  // zh-TW is the only Chinese catalog, so every Chinese system locale lands on it; any other
  // language has no catalog and gets English.
  return navigator.language.toLowerCase().startsWith("zh")
    ? Locale.ZhTW
    : Locale.EnUS;
}

/** The language the app is showing; i18next only ever switches to a `Locale`. */
export function currentLocale(): Locale {
  return localeSchema.parse(i18next.language);
}

export function changeLanguagePreference(preference: LanguagePreference) {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, preference);

  return i18next.changeLanguage(resolveLocale(preference));
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
  lng: resolveLocale(languagePreference()),
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
