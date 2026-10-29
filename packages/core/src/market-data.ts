import * as z from "zod";

import type { BarInterval, Candle, Interval } from "./candles.ts";
import type { Market, SymbolRef } from "./market.ts";

export interface CandleRequest {
  symbol: SymbolRef;
  /** Weekly and monthly bars are merged from daily ones where they are charted, since a provider may clip its own to the requested range. */
  interval: BarInterval;
  /** Exchange-local dates (`YYYY-MM-DD`), inclusive. */
  from: string;
  to: string;
}

/** How the exchange names a listing. */
export interface Listing {
  /** The exchange's own name, such as 台積電, or for a listing abroad the source's traditional Chinese one. */
  name: string;
  englishName: string | null;
}

/** A listing a search found, named as its market knows it. */
export interface ListingMatch {
  symbol: SymbolRef;
  name: string;
  /** `null` where the source gives none, as Taiwan's exchanges do. */
  englishName: string | null;
}

/** What a search found, best first, and the markets it asked whose listings could not be read, whose matches are missing. */
export interface ListingSearch {
  matches: ListingMatch[];
  unread: Market[];
}

/** A listing's or an index's trading in its newest session so far, as the exchange reports it. */
export const quoteSchema = z.object({
  /** The session's exchange-local date, `YYYY-MM-DD`. */
  date: z.string(),
  last: z.number(),
  /** What the session's change is measured from: the reference price, which ex-dividend days lower, or else the last close. */
  reference: z.number(),
  /** Value traded so far, in the market's currency. */
  tradeValue: z.number(),
});

export type Quote = z.infer<typeof quoteSchema>;

/** A price on one side of a listing's book and the shares waiting at it. */
export interface DepthLevel {
  price: number;
  shares: number;
}

/** A listing's session so far as its exchange discloses it, with the best bids and asks waiting. */
export interface Depth {
  /** The session's exchange-local date, `YYYY-MM-DD`. */
  date: string;
  /** UTC milliseconds of the exchange's latest change to it. */
  time: number;
  /** What the session's change is measured from, as `Quote.reference` is. */
  reference: number;
  /** The session's prices traded so far; `null` until it trades. */
  open: number | null;
  high: number | null;
  low: number | null;
  last: number | null;
  /** The price of its shares traded so far on average, by volume. */
  average: number | null;
  /** Shares traded so far, and those of them that sold at the bid or bought at the ask. */
  volume: number;
  volumeAtBid: number;
  volumeAtAsk: number;
  /** The best first, five at the most; a side may be empty. */
  bids: DepthLevel[];
  asks: DepthLevel[];
  /** The exchange is matching trial orders before an auction, so the book shows what would match rather than trades. */
  trial: boolean;
}

/** One implementation per data provider (`@solyx/market-data/*`); it runs only in the main process. */
export interface MarketDataProvider {
  readonly id: string;
  readonly markets: readonly Market[];
  /** Returns bars in strictly ascending time, including today's session when `to` reaches today; a symbol the provider does not list has none. */
  getCandles(request: CandleRequest): Promise<Candle[]>;
  /** `null` for a symbol the provider does not list. */
  getListing(symbol: SymbolRef): Promise<Listing | null>;
  /** `null` for a symbol the provider does not list or that has not traded yet. */
  getQuote(symbol: SymbolRef): Promise<Quote | null>;
  /** `null` for a symbol the provider does not list or that keeps no book, as an index keeps none. */
  getDepth(symbol: SymbolRef): Promise<Depth | null>;
}

/** A market index's close at one session on total return, with what its members paid out reinvested. */
export interface ReturnClose {
  /** The session's exchange-local date, `YYYY-MM-DD`. */
  date: string;
  close: number;
}

/** One implementation per source of a market's index on total return, which no market data source serves the history of. */
export interface TotalReturnProvider {
  readonly id: string;
  readonly markets: readonly Market[];
  /** Each session's close from `since` (`YYYY-MM-DD`) on, oldest first; none for a market it does not cover. */
  getTotalReturn(market: Market, since: string): Promise<ReturnClose[]>;
}

/** Each market's index on total return, from the source that covers it. */
export interface MarketReturns {
  /** Each session's close over the daily bars' lookback, oldest first; rejects while no source covers the market. */
  closes(market: Market): Promise<ReturnClose[]>;
}

/** Bars and names in every market, from the source the user picked for it. */
export interface MarketData {
  /** Bars over the interval's lookback, oldest first; rejects while no source covers the market. */
  candles(symbol: SymbolRef, interval: Interval): Promise<Candle[]>;
  /** `null` when no source covers the market or the source does not list the symbol. */
  listing(symbol: SymbolRef): Promise<Listing | null>;
}

export interface MinuteListener {
  /** The session's minute bars so far: sent when watching starts and after every reconnect, since pushes during an outage are lost. */
  onSession(minutes: Candle[]): void;
  /** A minute bar as trades update it; the last push for a minute is its final state. */
  onMinute(minute: Candle): void;
}

/**
 * Live minute bars and depth from a provider's stream; one implementation per provider, main
 * process only. A symbol's bars and its depth are a subscription each.
 */
export interface MarketDataStream {
  readonly id: string;
  readonly markets: readonly Market[];
  /** Starts watching `symbol`'s bars; returns a function that stops, or `undefined` when the stream cannot take another subscription. */
  watchMinutes(
    symbol: SymbolRef,
    listener: MinuteListener
  ): (() => void) | undefined;
  /** Starts watching `symbol`'s depth, each change of it whole, as `watchMinutes` does its bars. */
  watchDepth(
    symbol: SymbolRef,
    listener: (depth: Depth) => void
  ): (() => void) | undefined;
  close(): void;
}

/** A plan a provider sells; `id` is the provider's own name for it. */
export interface MarketDataPlan<Id extends string = string> {
  id: Id;
  /** Subscriptions its live stream holds at once, each one symbol's bars or its depth. */
  streamSubscriptions: number;
  /** REST requests per minute for today's session and for history. */
  requestsPerMinute: { intraday: number; historical: number };
}
