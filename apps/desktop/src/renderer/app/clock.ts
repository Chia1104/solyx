import { useMemo } from "react";

import { useTranslation } from "react-i18next";
import * as z from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { timeZoneSchema } from "#shared/ipc/settings.ts";
import type { TimeZone } from "#shared/ipc/settings.ts";

import { persistOptions } from "./persist.ts";

/** The time zone the user picked: an IANA name, or `system` to follow the computer's clock. */
export const TimeZonePreference = { System: "system" } as const;

export type TimeZonePreference =
  | (typeof TimeZonePreference)[keyof typeof TimeZonePreference]
  | TimeZone;

export const timeZonePreferenceSchema = z.union([
  z.literal(TimeZonePreference.System),
  timeZoneSchema,
]);

interface ClockStore {
  preference: TimeZonePreference;
  setPreference: (preference: TimeZonePreference) => void;
}

export const useClockStore = create<ClockStore>()(
  persist(
    (set) => ({
      preference: TimeZonePreference.System,
      setPreference: (preference) => set({ preference }),
    }),
    persistOptions<ClockStore>(
      "clock",
      z.object({ preference: timeZonePreferenceSchema })
    )
  )
);

/** The computer's time zone. */
export const systemTimeZone = (): TimeZone =>
  new Intl.DateTimeFormat().resolvedOptions().timeZone;

export function resolveTimeZone(preference: TimeZonePreference): TimeZone {
  return preference === TimeZonePreference.System
    ? systemTimeZone()
    : preference;
}

/** The time zone the app shows its own events in, for code outside React; components use `useClock`. */
export const currentTimeZone = (): TimeZone =>
  resolveTimeZone(useClockStore.getState().preference);

/** Formats moments on the user's own clock, in the app's language. */
export interface Clock {
  timeZone: TimeZone;
  /** The time of day for a moment today, the date and time for an earlier one. */
  time(at: number): string;
  /** The full date and time, for a tooltip. */
  fullTime(at: number): string;
  /** The calendar date. */
  date(at: number): string;
}

export function clock(
  locale: string,
  timeZone: TimeZone,
  now: () => Date = () => new Date()
): Clock {
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { timeZone, ...options });

  const time = format({ timeStyle: "short" });
  const dateTime = format({ dateStyle: "medium", timeStyle: "short" });
  const fullTime = format({ dateStyle: "full", timeStyle: "medium" });
  const date = format({ dateStyle: "medium" });
  // Two moments share a day only on this clock, so the day is read in its zone rather than the computer's.
  const day = format({ year: "numeric", month: "numeric", day: "numeric" });

  return {
    timeZone,
    time: (at) =>
      day.format(at) === day.format(now())
        ? time.format(at)
        : dateTime.format(at),
    fullTime: (at) => fullTime.format(at),
    date: (at) => date.format(at),
  };
}

/** The clock the app's language and the user's time zone give, rebuilt when either changes. */
export function useClock(): Clock {
  const { i18n } = useTranslation();
  const timeZone = useClockStore((state) => resolveTimeZone(state.preference));

  return useMemo(
    () => clock(i18n.language, timeZone),
    [i18n.language, timeZone]
  );
}
