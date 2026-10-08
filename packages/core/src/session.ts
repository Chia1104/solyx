import {
  Market,
  exchangeClock,
  exchangeDate,
  exchangeMidnight,
  shiftDate,
} from "./market.ts";

export const Session = {
  Pre: "pre",
  Regular: "regular",
  Post: "post",
  Closed: "closed",
} as const;

export type Session = (typeof Session)[keyof typeof Session];

interface SessionWindow {
  session: Exclude<Session, typeof Session.Closed>;
  start: number;
  end: number;
}

function sessionWindow(
  session: SessionWindow["session"],
  start: string,
  end: string
): SessionWindow {
  const minutes = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);

    return h * 60 + m;
  };

  return { session, start: minutes(start), end: minutes(end) };
}

const REGULAR_WINDOWS: Record<Market, SessionWindow> = {
  [Market.TW]: sessionWindow(Session.Regular, "09:00", "13:30"),
  [Market.US]: sessionWindow(Session.Regular, "09:30", "16:00"),
};

/** ISO weekday numbering, Monday 1 to Sunday 7, so Saturday opens the weekend. */
const SATURDAY = 6;

// `getSession` knows no exchange holidays, typhoon closures or US early closes.
const SESSION_WINDOWS: Record<Market, SessionWindow[]> = {
  // Pre-open matching → regular session → after-hours fixed-price trading
  [Market.TW]: [
    sessionWindow(Session.Pre, "08:30", "09:00"),
    REGULAR_WINDOWS[Market.TW],
    sessionWindow(Session.Post, "14:00", "14:30"),
  ],
  [Market.US]: [
    sessionWindow(Session.Pre, "04:00", "09:30"),
    REGULAR_WINDOWS[Market.US],
    sessionWindow(Session.Post, "16:00", "20:00"),
  ],
};

export function getSession(market: Market, at: Date = new Date()): Session {
  const { dayOfWeek, hour, minute } = exchangeClock(market, at);
  const minutes = hour * 60 + minute;

  if (dayOfWeek >= SATURDAY) return Session.Closed;

  return (
    SESSION_WINDOWS[market].find((w) => minutes >= w.start && minutes < w.end)
      ?.session ?? Session.Closed
  );
}

/** The UTC seconds at which the regular session of `date`, exchange-local `YYYY-MM-DD`, opens and closes. */
export function regularHours(market: Market, date: string) {
  const midnight = exchangeMidnight(market, date);
  const { start, end } = REGULAR_WINDOWS[market];

  return { open: midnight + start * 60, close: midnight + end * 60 };
}

/** Whether a market trades on an exchange-local `YYYY-MM-DD` day. */
export type TradingDays = (date: string) => boolean;

/** Every weekday trades: the rule for a market whose holidays are not known. */
export const weekdays: TradingDays = (date) =>
  Temporal.PlainDate.from(date).dayOfWeek < SATURDAY;

/**
 * The days an exchange set from `since` on, `listed` ascending: through the last of them a day
 * trades only when listed, and outside that span every weekday does.
 */
export function listedTradingDays(
  since: string,
  listed: readonly string[]
): TradingDays {
  const days = new Set(listed);
  const last = listed.at(-1);

  return (date) =>
    last !== undefined && date >= since && date <= last
      ? days.has(date)
      : weekdays(date);
}

/** Where a market's trading days come from, as far ahead as its exchange has set them. */
export interface TradingCalendarProvider {
  readonly markets: readonly Market[];
  /** Every exchange-local day the market trades from `since` on, ascending. */
  tradingDays(market: Market, since: string): Promise<string[]>;
}

/** How many regular sessions trade between `from` and `to`, counting one already under way at either end. */
export function sessionsBetween(
  market: Market,
  from: Date,
  to: Date,
  trades: TradingDays
): number {
  let sessions = 0;

  for (
    let date = exchangeDate(market, from);
    date <= exchangeDate(market, to);
    date = shiftDate(date, 1)
  ) {
    if (!trades(date)) continue;

    const { open, close } = regularHours(market, date);

    if (close * 1000 > from.getTime() && open * 1000 < to.getTime()) {
      sessions += 1;
    }
  }

  return sessions;
}
