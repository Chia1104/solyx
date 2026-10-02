import { memoize } from "es-toolkit";
import * as z from "zod";

export const Market = {
  TW: "TW",
  US: "US",
} as const;

export type Market = (typeof Market)[keyof typeof Market];

export const marketSchema = z.enum(Market);

export const MARKET_TIME_ZONE: Record<Market, string> = {
  [Market.TW]: "Asia/Taipei",
  [Market.US]: "America/New_York",
};

export const Currency = {
  TWD: "TWD",
  USD: "USD",
} as const;

export type Currency = (typeof Currency)[keyof typeof Currency];

/** Tick rules differ between stocks and ETFs in Taiwan, so the kind travels with the symbol. */
export const InstrumentKind = {
  Stock: "stock",
  ETF: "etf",
} as const;

export type InstrumentKind =
  (typeof InstrumentKind)[keyof typeof InstrumentKind];

export const instrumentKindSchema = z.enum(InstrumentKind);

/** A listing as market data sees it, where the stock/ETF distinction does not matter. */
export const symbolRefSchema = z.object({
  market: marketSchema,
  /** Exchange code as the market writes it: `2330`, `0050`, `AAPL`. */
  symbol: z.string().trim().toUpperCase().min(1),
});

export type SymbolRef = z.infer<typeof symbolRefSchema>;

export const instrumentSchema = symbolRefSchema.extend({
  kind: instrumentKindSchema,
});

export type Instrument = z.infer<typeof instrumentSchema>;

/** Identifies a listing across markets, as `TW:2330`. */
export function symbolKey({ market, symbol }: SymbolRef): string {
  return `${market}:${symbol}`;
}

export function currencyOf(market: Market): Currency {
  return market === Market.TW ? Currency.TWD : Currency.USD;
}

const exchangeClockFormatter = memoize(
  (market: Market) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: MARKET_TIME_ZONE[market],
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
);

/** The exchange's wall clock at `at`, as zero-padded fields and the weekday as `Mon`…`Sun`. */
export function exchangeClock(market: Market, at: Date = new Date()) {
  const parts = Object.fromEntries(
    exchangeClockFormatter(market)
      .formatToParts(at)
      .map((part) => [part.type, part.value])
  );

  return {
    weekday: parts.weekday,
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** The exchange-local calendar date as `YYYY-MM-DD`. */
export function exchangeDate(market: Market, at: Date = new Date()): string {
  const { year, month, day } = exchangeClock(market, at);

  return `${year}-${month}-${day}`;
}

/** `YYYY-MM-DD HH:mm` on the exchange's clock. */
export function exchangeTime(market: Market, at: Date = new Date()): string {
  const { year, month, day, hour, minute } = exchangeClock(market, at);

  return `${year}-${month}-${day} ${hour}:${minute}`;
}

/** UTC seconds at which an exchange-local calendar date (`YYYY-MM-DD`) begins. */
export function exchangeMidnight(market: Market, date: string): number {
  const utcMidnight = Date.parse(`${date}T00:00:00Z`);
  const clock = exchangeClock(market, new Date(utcMidnight));

  const local = Date.UTC(
    Number(clock.year),
    Number(clock.month) - 1,
    Number(clock.day),
    Number(clock.hour),
    Number(clock.minute),
    Number(clock.second)
  );

  // The zone's offset at UTC midnight; exchanges do not change clocks around their midnight.
  return (utcMidnight - (local - utcMidnight)) / 1000;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Moves a `YYYY-MM-DD` calendar date by whole days. */
export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}
