import { useSuspenseQuery } from "@tanstack/react-query";
import { memoize } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { clock } from "#shared/clock.ts";
import type { Clock } from "#shared/clock.ts";
import { TimeZonePreference, resolveTimeZone } from "#shared/ipc/settings.ts";
import type { Appearance, TimeZone } from "#shared/ipc/settings.ts";

import { appearanceQuery } from "../modules/settings/settings-query.ts";

import { queryClient } from "./query-client.ts";

/** The computer's time zone. */
export const systemTimeZone = (): TimeZone =>
  new Intl.DateTimeFormat().resolvedOptions().timeZone;

const selectTimeZone = (appearance: Appearance) => appearance.timeZone;

/** The time zone the app shows its own events in, for code outside React; components use `useClock`. */
export const currentTimeZone = (): TimeZone =>
  resolveTimeZone(
    queryClient.getQueryData(appearanceQuery().queryKey)?.timeZone ??
      TimeZonePreference.System,
    systemTimeZone()
  );

// Built once per language and zone, since a conversation reads one for every message.
const sharedClock = memoize(
  ([locale, timeZone]: [string, TimeZone]) => clock(locale, timeZone),
  { getCacheKey: ([locale, timeZone]) => `${locale} ${timeZone}` }
);

/** The clock the app's language and the user's time zone give. */
export function useClock(): Clock {
  const { i18n } = useTranslation();

  const { data: preference } = useSuspenseQuery({
    ...appearanceQuery(),
    select: selectTimeZone,
  });

  return sharedClock([
    i18n.language,
    resolveTimeZone(preference, systemTimeZone()),
  ]);
}
