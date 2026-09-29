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

export function currencyOf(market: Market): Currency {
  return market === Market.TW ? Currency.TWD : Currency.USD;
}

const exchangeDateFormatter = memoize(
  (timeZone: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
);

/** The exchange-local calendar date as `YYYY-MM-DD`. */
export function exchangeDate(market: Market, at: Date = new Date()): string {
  return exchangeDateFormatter(MARKET_TIME_ZONE[market]).format(at);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Moves a `YYYY-MM-DD` calendar date by whole days. */
export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}
