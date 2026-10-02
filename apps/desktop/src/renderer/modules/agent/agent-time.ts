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

/** The time of day for today's messages, the date and time for older ones. */
export function formatMessageTime(
  at: number,
  locale: string,
  now = new Date()
): string {
  const date = new Date(at);
  const formats = timeFormats(locale);

  return date.toDateString() === now.toDateString()
    ? formats.time.format(date)
    : formats.dateTime.format(date);
}

export function formatMessageTimeFull(at: number, locale: string): string {
  return timeFormats(locale).full.format(at);
}
