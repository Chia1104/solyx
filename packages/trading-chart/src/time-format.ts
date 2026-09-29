import { TickMarkType, isUTCTimestamp } from "lightweight-charts";
import type {
  TickMarkFormatter,
  Time,
  TimeFormatterFn,
  UTCTimestamp,
} from "lightweight-charts";

export function utcTimestamp(seconds: number): UTCTimestamp {
  // SAFETY: callers pass UTC seconds, which is exactly what the UTCTimestamp brand denotes.
  return seconds as UTCTimestamp;
}

export interface ExchangeTimeFormat {
  tickMarkFormatter: TickMarkFormatter;
  timeFormatter: TimeFormatterFn;
}

/**
 * Lightweight Charts has no time zone option, so UTC timestamps are formatted in the exchange's
 * own zone; `intraday` adds the time of day to the crosshair label.
 */
export function exchangeTimeFormat(
  timeZone: string,
  locale: string,
  intraday: boolean
): ExchangeTimeFormat {
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { timeZone, hourCycle: "h23", ...options });

  const date = { year: "numeric", month: "2-digit", day: "2-digit" } as const;
  const time = { hour: "2-digit", minute: "2-digit" } as const;

  const tickMarks: Record<TickMarkType, Intl.DateTimeFormat> = {
    [TickMarkType.Year]: format({ year: "numeric" }),
    [TickMarkType.Month]: format({ month: "short" }),
    [TickMarkType.DayOfMonth]: format({ month: "numeric", day: "numeric" }),
    [TickMarkType.Time]: format(time),
    [TickMarkType.TimeWithSeconds]: format({ ...time, second: "2-digit" }),
  };

  const crosshair = format(intraday ? { ...date, ...time } : date);

  const toDate = (value: Time) =>
    isUTCTimestamp(value) ? new Date(value * 1000) : null;

  return {
    tickMarkFormatter: (value, tickMarkType) => {
      const at = toDate(value);

      return at ? tickMarks[tickMarkType].format(at) : null;
    },
    timeFormatter: (value) => {
      const at = toDate(value);

      return at ? crosshair.format(at) : "";
    },
  };
}
