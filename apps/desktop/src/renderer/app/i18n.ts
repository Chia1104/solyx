import { QueryObserver } from "@tanstack/react-query";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import enUS from "@solyx/i18n/desktop/en-US.json";
import zhTW from "@solyx/i18n/desktop/zh-TW.json";

import {
  LanguagePreference,
  Locale,
  localeSchema,
  resolveLocale,
} from "#shared/ipc/settings.ts";
import type { Appearance } from "#shared/ipc/settings.ts";

import { appearanceQuery } from "../modules/settings/settings-query.ts";

import { queryClient } from "./query-client.ts";

const showLanguage = (preference: LanguagePreference) =>
  i18next.changeLanguage(resolveLocale(preference, navigator.language));

const selectLanguage = (appearance: Appearance) => appearance.language;

/**
 * Shows the language the appearance names, saved in settings or by hand in the config file.
 * Resolves once the saved one shows, so the first render is already in it.
 */
export async function followLanguage() {
  new QueryObserver(queryClient, {
    ...appearanceQuery(),
    select: selectLanguage,
  }).subscribe(({ data }) => {
    if (data) void showLanguage(data);
  });

  await showLanguage(
    selectLanguage(await queryClient.query(appearanceQuery()))
  );
}

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
