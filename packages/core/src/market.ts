import * as z from "zod";

import { wallTime } from "@solyx/utils/date";

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

export const currencySchema = z.enum(Currency);

/** A listing, by its market and the code its exchange gives it. */
export const symbolRefSchema = z.object({
  market: marketSchema,
  /** Exchange code as the market writes it: `2330`, `0050`, `AAPL`. */
  symbol: z.string().trim().toUpperCase().min(1),
});

export type SymbolRef = z.infer<typeof symbolRefSchema>;

/** What a market's listings are measured against. */
export interface Benchmark {
  symbol: SymbolRef;
  name: string;
}

/** Taiwan's capitalization-weighted index, and an S&P 500 fund for the US. */
export const BENCHMARK: Record<Market, Benchmark> = {
  [Market.TW]: {
    symbol: { market: Market.TW, symbol: "IX0001" },
    name: "TAIEX",
  },
  [Market.US]: {
    symbol: { market: Market.US, symbol: "SPY" },
    name: "S&P 500 (SPY)",
  },
};

/** A listing as text written for a person or a model reads it, `TW 2330`. */
export const symbolLabel = ({ market, symbol }: SymbolRef) =>
  `${market} ${symbol}`;

/** Identifies a listing across markets, as `TW:2330`. */
export function symbolKey({ market, symbol }: SymbolRef): string {
  return `${market}:${symbol}`;
}

export function currencyOf(market: Market): Currency {
  return market === Market.TW ? Currency.TWD : Currency.USD;
}

/** The exchange's wall clock at `at`. */
export function exchangeClock(
  market: Market,
  at: Date = new Date()
): Temporal.ZonedDateTime {
  return Temporal.Instant.fromEpochMilliseconds(
    at.getTime()
  ).toZonedDateTimeISO(MARKET_TIME_ZONE[market]);
}

/** The exchange-local calendar date as `YYYY-MM-DD`. */
export function exchangeDate(market: Market, at: Date = new Date()): string {
  return exchangeClock(market, at).toPlainDate().toString();
}

/** `YYYY-MM-DD HH:mm` on the exchange's clock. */
export function exchangeTime(market: Market, at: Date = new Date()): string {
  return wallTime(MARKET_TIME_ZONE[market], at);
}

/** UTC seconds at which an exchange-local calendar date (`YYYY-MM-DD`) begins. */
export function exchangeMidnight(market: Market, date: string): number {
  return (
    Temporal.PlainDate.from(date).toZonedDateTime(MARKET_TIME_ZONE[market])
      .epochMilliseconds / 1000
  );
}
