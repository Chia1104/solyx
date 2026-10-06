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
  return exchangeClock(market, at)
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" })
    .replace("T", " ");
}

/** UTC seconds at which an exchange-local calendar date (`YYYY-MM-DD`) begins. */
export function exchangeMidnight(market: Market, date: string): number {
  return (
    Temporal.PlainDate.from(date).toZonedDateTime(MARKET_TIME_ZONE[market])
      .epochMilliseconds / 1000
  );
}

/** Moves a `YYYY-MM-DD` calendar date by whole days. */
export function shiftDate(date: string, days: number): string {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}
