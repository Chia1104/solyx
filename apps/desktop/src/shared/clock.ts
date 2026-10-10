import type { TimeZone } from "./ipc/settings.ts";

/** Formats moments on the user's own clock, in the app's language. */
export interface Clock {
  timeZone: TimeZone;
  /** The time of day for a moment today, the date and time for one on another day. */
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
