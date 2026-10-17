import { zhTW } from "@fumadocs/language/zh-tw";
import { useParams } from "@tanstack/react-router";
import { defineI18n } from "fumadocs-core/i18n";
import { uiTranslations } from "fumadocs-ui/i18n";
import i18next from "i18next";

import desktopEnUS from "@solyx/i18n/desktop/en-US.json";
import desktopZhTW from "@solyx/i18n/desktop/zh-TW.json";
import websiteEnUS from "@solyx/i18n/website/en-US.json";
import websiteZhTW from "@solyx/i18n/website/zh-TW.json";
import { isEnumValue } from "@solyx/utils/is";

/** The languages the site is written in, by the codes its URLs use. */
export const Locale = {
  EnUS: "en-US",
  ZhTW: "zh-TW",
} as const;

export type Locale = (typeof Locale)[keyof typeof Locale];

/** English is the site's own address; every other locale is the first segment of its path. */
export const i18n = defineI18n({
  languages: Object.values(Locale),
  defaultLanguage: Locale.EnUS,
  hideLocale: "default-locale",
});

/** Fumadocs' own words in each locale, with the names its language switcher shows. */
export const uiTranslationsByLocale = i18n
  .translations()
  .extend(uiTranslations())
  .preset(Locale.ZhTW, zhTW())
  .add({ [Locale.EnUS]: { displayName: "English" } });

const resources = {
  [Locale.EnUS]: { website: websiteEnUS, desktop: desktopEnUS },
  [Locale.ZhTW]: { website: websiteZhTW, desktop: desktopZhTW },
};

function translatorFor(locale: Locale) {
  const translator = i18next.createInstance();

  // Catalogs are bundled, so the instance is ready before anything renders.
  void translator.init({
    lng: locale,
    resources,
    ns: ["website", "desktop"],
    defaultNS: "website",
    fallbackLng: Locale.EnUS,
    initAsync: false,
    interpolation: { escapeValue: false },
  });

  return translator;
}

/** One i18next per locale, so pages prerendered side by side never share a language. */
export const translators = {
  [Locale.EnUS]: translatorFor(Locale.EnUS),
  [Locale.ZhTW]: translatorFor(Locale.ZhTW),
};

/** The locale a URL's optional first segment names: none is English, and an unknown one is no locale. */
export function localeOf(lang: string | undefined): Locale | undefined {
  if (lang === undefined) return Locale.EnUS;

  return isEnumValue(Locale, lang) ? lang : undefined;
}

/** The `{-$lang}` segment for a locale, which English leaves out. */
export function langParam(locale: Locale): Locale | undefined {
  return locale === Locale.EnUS ? undefined : locale;
}

/** A site path in a locale: `/docs` is `/zh-TW/docs` in Traditional Chinese, and `/` is `/zh-TW`. */
export function localePath(locale: Locale, path: string): string {
  if (locale === Locale.EnUS) return path;

  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

/** The locale of the page on screen. */
export function useLocale(): Locale {
  const { lang } = useParams({ strict: false });

  return localeOf(lang) ?? Locale.EnUS;
}

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "website";
    resources: { website: typeof websiteEnUS; desktop: typeof desktopEnUS };
  }
}
