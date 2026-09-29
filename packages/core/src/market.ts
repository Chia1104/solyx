export const Market = {
  TW: "TW",
  US: "US",
} as const;

export type Market = (typeof Market)[keyof typeof Market];

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

export interface Instrument {
  market: Market;
  /** Exchange code as the market writes it: `2330`, `0050`, `AAPL`. */
  symbol: string;
  kind: InstrumentKind;
}

export function currencyOf(market: Market): Currency {
  return market === Market.TW ? Currency.TWD : Currency.USD;
}
