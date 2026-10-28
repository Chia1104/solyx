import { shiftDate } from "@solyx/utils/date";

import {
  Market,
  exchangeClock,
  exchangeDate,
  exchangeMidnight,
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

const US_EARLY_REGULAR = sessionWindow(Session.Regular, "09:30", "13:00");

/** A day whose regular session closes early, in a market that has such days: that session and all the day's. */
const EARLY_CLOSES: Partial<
  Record<Market, { regular: SessionWindow; sessions: SessionWindow[] }>
> = {
  [Market.US]: {
    regular: US_EARLY_REGULAR,
    sessions: [
      sessionWindow(Session.Pre, "04:00", "09:30"),
      US_EARLY_REGULAR,
      sessionWindow(Session.Post, "13:00", "17:00"),
    ],
  },
};

/** Which exchange-local `YYYY-MM-DD` days a market trades. */
export interface TradingDays {
  (date: string): boolean;
  /** Whether the day's regular session closes early, as the US market's does before some holidays. */
  closesEarly(date: string): boolean;
}

/** Every weekday trades in full: the rule for a market whose holidays are not known. */
export const weekdays: TradingDays = Object.assign(
  (date: string) => Temporal.PlainDate.from(date).dayOfWeek < SATURDAY,
  { closesEarly: () => false }
);

function earlyClose(market: Market, date: string, trades: TradingDays) {
  return trades.closesEarly(date) ? EARLY_CLOSES[market] : undefined;
}

/**
 * The session a market is in, closed all day on a day `trades` says it does not trade. It knows
 * no closure called on the day, as for a typhoon.
 */
export function getSession(
  market: Market,
  at: Date = new Date(),
  trades: TradingDays = weekdays
): Session {
  const date = exchangeDate(market, at);

  if (!trades(date)) return Session.Closed;

  const { hour, minute } = exchangeClock(market, at);
  const minutes = hour * 60 + minute;

  const windows =
    earlyClose(market, date, trades)?.sessions ?? SESSION_WINDOWS[market];

  return (
    windows.find((w) => minutes >= w.start && minutes < w.end)?.session ??
    Session.Closed
  );
}

/** The UTC seconds at which the regular session of `date`, exchange-local `YYYY-MM-DD`, opens and closes. */
export function regularHours(
  market: Market,
  date: string,
  trades: TradingDays = weekdays
) {
  const midnight = exchangeMidnight(market, date);

  const { start, end } =
    earlyClose(market, date, trades)?.regular ?? REGULAR_WINDOWS[market];

  return { open: midnight + start * 60, close: midnight + end * 60 };
}

// No market stays closed for a year, so a search past that finds no session.
const LONGEST_CLOSURE_DAYS = 366;

/** The first exchange-local day after `date` that `trades`, looked for a year ahead at most. */
export function nextTradingDay(
  date: string,
  trades: TradingDays = weekdays
): string {
  let day = shiftDate(date, 1);

  for (let days = 1; !trades(day) && days < LONGEST_CLOSURE_DAYS; days += 1) {
    day = shiftDate(day, 1);
  }

  return day;
}

/** The exchange-local day of the regular session under way at `at`, or else of the next one to open. */
export function sessionDayAt(
  market: Market,
  at: Date = new Date(),
  trades: TradingDays = weekdays
): string {
  const today = exchangeDate(market, at);

  return trades(today) &&
    at.getTime() < regularHours(market, today, trades).close * 1000
    ? today
    : nextTradingDay(today, trades);
}

/** The days an exchange has set a market to trade, ascending, and those of them its regular session closes early. */
export interface ExchangeDays {
  trading: string[];
  earlyCloses: string[];
}

/**
 * The days an exchange set from `since` on: through the last of them a day trades only when
 * listed, and outside that span every weekday trades in full.
 */
export function listedTradingDays(
  since: string,
  { trading, earlyCloses }: ExchangeDays
): TradingDays {
  const days = new Set(trading);
  const early = new Set(earlyCloses);
  const last = trading.at(-1);

  const listed = (date: string) =>
    last !== undefined && date >= since && date <= last;

  return Object.assign(
    (date: string) => (listed(date) ? days.has(date) : weekdays(date)),
    { closesEarly: (date: string) => listed(date) && early.has(date) }
  );
}

/** Where a market's trading days come from, as far ahead as its exchange has set them. */
export interface TradingCalendarProvider {
  readonly markets: readonly Market[];
  /** The days the market trades from `since` on, exchange-local. */
  tradingDays(market: Market, since: string): Promise<ExchangeDays>;
}

/** A weekday an exchange has set its market closed, with what it calls the day. */
export interface MarketClosure {
  market: Market;
  /** `YYYY-MM-DD` on the exchange's calendar. */
  date: string;
  /** Why, in the exchange's words, such as a holiday's name. */
  name: string;
}

/** Where the weekdays an exchange has set its market closed come from; it runs only in the main process. */
export interface ClosuresProvider {
  readonly id: string;
  readonly markets: readonly Market[];
  /** The closures the exchange lists, ascending, those of days gone by among them; none for a market it does not cover. */
  getClosures(market: Market): Promise<MarketClosure[]>;
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

    const { open, close } = regularHours(market, date, trades);

    if (close * 1000 > from.getTime() && open * 1000 < to.getTime()) {
      sessions += 1;
    }
  }

  return sessions;
}
