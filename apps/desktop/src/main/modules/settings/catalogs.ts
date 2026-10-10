import enUS from "@solyx/i18n/desktop/en-US.json" with { type: "json" };
import zhTW from "@solyx/i18n/desktop/zh-TW.json" with { type: "json" };

import { Locale } from "#shared/ipc/settings.ts";

/** Each language's catalog, for what the main process writes itself, such as the tray's menu. */
export const CATALOGS: Record<Locale, typeof enUS> = {
  [Locale.EnUS]: enUS,
  [Locale.ZhTW]: zhTW,
};

/** Fills an entry's `{{name}}` marks as i18next does in the renderer. */
export function fill(entry: string, values: Record<string, string | number>) {
  return entry.replaceAll(/\{\{(\w+)\}\}/g, (mark, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : mark
  );
}

/** Picks the entry for `count` in `locale`, of the two forms these catalogs keep. */
export function plural(
  locale: Locale,
  count: number,
  forms: { one: string; other: string }
) {
  return new Intl.PluralRules(locale).select(count) === "one"
    ? forms.one
    : forms.other;
}
