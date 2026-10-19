import {
  Interval,
  isCalendarInterval,
  lookbackRange,
  olderRange,
  periodStart,
  resampleDaily,
} from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import { Market, symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { Listing, MarketDataProvider } from "@solyx/core/market-data";
import { sessionQuote } from "@solyx/core/quote";
import type { SessionQuote } from "@solyx/core/quote";
import { TW_SECTOR_INDICES } from "@solyx/core/sectors";
import type { SectorQuote } from "@solyx/core/sectors";
import { Session, getSession } from "@solyx/core/session";
import { MINUTE_MS } from "@solyx/utils/date";
import { freshFor, keepFresh } from "@solyx/utils/fresh";
import type { AnswerStores } from "@solyx/utils/fresh";

import type { Diagnostics } from "../telemetry/diagnostics.ts";

import { createLiveCandles } from "./live-candles.ts";
import { createLiveDepth } from "./live-depth.ts";
import { createLiveStream } from "./live-stream.ts";
import type { MarketDataSources } from "./market-data-sources.ts";
import type { MarketDays } from "./trading-calendar.ts";

/** The sectors cost a request per index, so the overview's map and the agent share a read this long. */
const SECTORS_FRESH_MS = MINUTE_MS;

interface MarketDataOptions {
  sources: MarketDataSources;
  /** The days each market trades, which tell when a book is read again. */
  marketDays: MarketDays;
  /** Where the sectors' answer is kept between reads. */
  answers: AnswerStores;
  diagnostics: Pick<Diagnostics, "recovered">;
  /** Where some market's bars come from changed: charts load again and watch afresh. */
  onSourcesChanged: () => void;
  /** @default () => new Date() */
  now?: () => Date;
}

/**
 * Every market's bars, names, live bars and depth, from the sources the user's settings pick; weekly and
 * monthly bars are merged here from daily ones, for history and the live bar alike. Reopens the
 * live stream whenever the sources say it changed, and tells windows so.
 */
export function createMarketData({
  sources,
  marketDays,
  answers,
  diagnostics,
  onSourcesChanged,
  now = () => new Date(),
}: MarketDataOptions) {
  const listings = new Map<string, Listing>();
  const stream = createLiveStream(() => sources.openStream());

  const live = createLiveCandles({
    stream,
    async dailyCandles(request) {
      const provider = await sources.provider(request.symbol.market);

      return provider ? provider.getCandles(request) : [];
    },
    now,
  });

  const depth = createLiveDepth({
    stream,
    async read(symbol) {
      const provider = await sources.provider(symbol.market);

      return provider ? provider.getDepth(symbol) : null;
    },
    trading: async (market) =>
      getSession(market, now(), await marketDays(market)) === Session.Regular,
    diagnostics,
  });

  const sectorQuotes = keepFresh<MarketDataProvider, SectorQuote[]>({
    store: answers("market:sectors"),
    id: (provider) => provider.id,
    ask: (provider) =>
      Promise.all(
        TW_SECTOR_INDICES.map(async (index) => ({
          ...index,
          quote: await provider.getQuote({
            market: Market.TW,
            symbol: index.symbol,
          }),
        }))
      ),
    fresh: freshFor(SECTORS_FRESH_MS),
    now: () => now().getTime(),
  });

  async function providerOf(market: Market) {
    const provider = await sources.provider(market);

    if (!provider) {
      throw new Error(
        `No market data for ${market}: no source covers it or its settings are incomplete`
      );
    }

    return provider;
  }

  sources.onStreamChange(() => {
    // Windows watch again once told, and their watches wait for the stream this restart opens.
    stream
      .restart()
      .catch((error) => diagnostics.recovered(error, "market.stream.restart"));
    onSourcesChanged();
  });

  async function read(
    symbol: SymbolRef,
    interval: Interval,
    { from, to }: { from: string; to: string }
  ): Promise<Candle[]> {
    const provider = await providerOf(symbol.market);

    if (!isCalendarInterval(interval)) {
      return provider.getCandles({ symbol, interval, from, to });
    }

    // Whole periods of daily bars, the ones the live bar of the current period starts from.
    const daily = await provider.getCandles({
      symbol,
      interval: Interval.OneDay,
      from: periodStart(from, interval),
      to,
    });

    return resampleDaily(daily, interval, symbol.market);
  }

  return {
    candles: (symbol: SymbolRef, interval: Interval) =>
      read(symbol, interval, lookbackRange(symbol.market, interval, now())),

    /**
     * Bars from `since` (`YYYY-MM-DD` on the exchange's calendar) on, where that reaches further
     * back than the lookback; the candle cache keeps what a source was asked for once.
     */
    candlesSince(symbol: SymbolRef, interval: Interval, since: string) {
      const { from, to } = lookbackRange(symbol.market, interval, now());

      return read(symbol, interval, { from: since < from ? since : from, to });
    },

    /** The page of history before the bar opening at `before`; empty once the source has nothing older. */
    olderCandles: (symbol: SymbolRef, interval: Interval, before: number) =>
      read(symbol, interval, olderRange(symbol.market, interval, before)),

    /**
     * Reads the five-minute bars a chart of that interval reads, so both share one cached series
     * and neither trims the other's window; only today's session costs a request.
     */
    async quote(symbol: SymbolRef): Promise<SessionQuote | null> {
      const provider = await sources.provider(symbol.market);

      if (!provider) return null;

      const interval = Interval.FiveMinutes;
      const { from, to } = lookbackRange(symbol.market, interval, now());

      return sessionQuote(
        symbol.market,
        await provider.getCandles({ symbol, interval, from, to })
      );
    },

    /** Every Taiwan sector index's session so far; `null` when no source covers Taiwan. */
    async sectors(): Promise<SectorQuote[] | null> {
      const provider = await sources.provider(Market.TW);

      return provider ? sectorQuotes(provider) : null;
    },

    /** Kept for the session once found, since news groups a listing's stories by its names on every read. */
    async listing(symbol: SymbolRef): Promise<Listing | null> {
      const known = listings.get(symbolKey(symbol));

      if (known) return known;

      const provider = await sources.provider(symbol.market);
      const listing = provider ? await provider.getListing(symbol) : null;

      if (listing) listings.set(symbolKey(symbol), listing);

      return listing;
    },

    /** Today's bars of `symbol` in `interval` as a live stream pushes them, as `follow` tells. */
    liveCandles: (
      symbol: SymbolRef,
      interval: Interval,
      signal?: AbortSignal
    ) => live.follow(symbol, interval, signal),

    /** `symbol`'s depth as it changes, as `follow` tells. */
    depth: (symbol: SymbolRef, signal?: AbortSignal) =>
      depth.follow(symbol, signal),

    status: () => sources.status(),

    signInFubon: () => sources.signInFubon(),
  };
}

export type MarketDataModule = ReturnType<typeof createMarketData>;
