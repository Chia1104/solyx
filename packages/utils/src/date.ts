export const MINUTE_MS = 60 * 1000;

export const HOUR_MS = 60 * MINUTE_MS;

export const DAY_MS = 24 * HOUR_MS;

export const HOUR_MINUTES = 60;

export const DAY_MINUTES = 24 * HOUR_MINUTES;

/** `YYYY-MM-DD HH:mm` on the clock of `timeZone`, an IANA name. */
export const wallTime = (timeZone: string, at: Date = new Date()) =>
  Temporal.Instant.fromEpochMilliseconds(at.getTime())
    .toZonedDateTimeISO(timeZone)
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" })
    .replace("T", " ");

/** Moves a `YYYY-MM-DD` calendar date by whole days. */
export const shiftDate = (date: string, days: number) =>
  Temporal.PlainDate.from(date).add({ days }).toString();

/** The `YYYY-MM-DD` calendar date of a day counted from 1970-01-01. */
export const epochDayDate = (day: number) =>
  new Date(day * DAY_MS).toISOString().slice(0, 10);

/** Moves a `YYYY-MM` month by whole months. */
export const shiftMonth = (month: string, months: number) =>
  Temporal.PlainYearMonth.from(month).add({ months }).toString();
