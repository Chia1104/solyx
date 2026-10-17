import { useSyncExternalStore } from "react";

import { useSuspenseQuery } from "@tanstack/react-query";
import { memoize } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { MINUTE_MS } from "@solyx/utils/date";

import { clock } from "#shared/clock.ts";
import type { Clock } from "#shared/clock.ts";
import { TimeZonePreference, resolveTimeZone } from "#shared/settings.ts";
import type { Appearance, TimeZone } from "#shared/settings.ts";

import { appearanceQuery } from "../modules/settings/settings-query.ts";

import { queryClient } from "./query-client.ts";

const selectTimeZone = (appearance: Appearance) => appearance.timeZone;

/** The time zone the app shows its own events in, for code outside React; components use `useClock`. */
export const currentTimeZone = (): TimeZone =>
  resolveTimeZone(
    queryClient.getQueryData(appearanceQuery().queryKey)?.timeZone ??
      TimeZonePreference.System,
    Temporal.Now.timeZoneId()
  );

// The user's day is looked at this often, since a clock tells a time of today without its date.
const DAY_CHECK_MS = MINUTE_MS;

const dayListeners = new Set<() => void>();

let dayTimer: ReturnType<typeof setInterval> | undefined;

/** One timer for the window, however many components tell times, kept only while one does. */
function subscribeToDay(listener: () => void) {
  dayListeners.add(listener);

  dayTimer ??= setInterval(() => {
    for (const each of dayListeners) each();
  }, DAY_CHECK_MS);

  return () => {
    dayListeners.delete(listener);

    if (dayListeners.size === 0) {
      clearInterval(dayTimer);
      dayTimer = undefined;
    }
  };
}

/** The day on the user's own clock. */
const userDay = () => Temporal.Now.plainDateISO(currentTimeZone()).toString();

// Built once per language and zone, since a conversation reads one for every message.
const sharedClock = memoize(
  ([locale, timeZone]: [string, TimeZone]) => clock(locale, timeZone),
  { getCacheKey: ([locale, timeZone]) => `${locale} ${timeZone}` }
);

/**
 * The clock the app's language and the user's time zone give. Its component renders again as the
 * user's day turns, so a time told as today's gains its date.
 */
export function useClock(): Clock {
  const { i18n } = useTranslation();

  useSyncExternalStore(subscribeToDay, userDay);

  const { data: preference } = useSuspenseQuery({
    ...appearanceQuery(),
    select: selectTimeZone,
  });

  return sharedClock([
    i18n.language,
    resolveTimeZone(preference, Temporal.Now.timeZoneId()),
  ]);
}
