import { memoize } from "es-toolkit";

const timeFormats = memoize((locale: string) => ({
  time: new Intl.DateTimeFormat(locale, { timeStyle: "short" }),
  dateTime: new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }),
  full: new Intl.DateTimeFormat(locale, {
    dateStyle: "full",
    timeStyle: "medium",
  }),
}));

/** The time of day for a moment today, the date and time for an earlier one. */
export function formatTime(at: number, locale: string, now = new Date()) {
  const date = new Date(at);
  const formats = timeFormats(locale);

  return date.toDateString() === now.toDateString()
    ? formats.time.format(date)
    : formats.dateTime.format(date);
}

export function formatFullTime(at: number, locale: string): string {
  return timeFormats(locale).full.format(at);
}
