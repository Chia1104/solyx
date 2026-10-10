import enUS from "@solyx/i18n/desktop/en-US.json" with { type: "json" };
import zhTW from "@solyx/i18n/desktop/zh-TW.json" with { type: "json" };

import { Locale } from "#shared/ipc/settings.ts";

/** Each language's catalog, for what the main process writes itself, such as the tray's menu. */
export const CATALOGS: Record<Locale, typeof enUS> = {
  [Locale.EnUS]: enUS,
  [Locale.ZhTW]: zhTW,
};
