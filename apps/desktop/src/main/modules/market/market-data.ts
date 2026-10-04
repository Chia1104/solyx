import {
  Interval,
  isCalendarInterval,
  lookbackRange,
  periodStart,
  resampleDaily,
} from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import type { Market, SymbolRef } from "@solyx/core/market";
import type { Listing } from "@solyx/core/market-data";

import { createLiveCandles } from "./live-candles.ts";
import type { LiveSender } from "./live-candles.ts";
import type { MarketDataSources } from "./market-data-sources.ts";

interface MarketDataOptions {
  sources: MarketDataSources;
  /** Where some market's bars come from changed: charts load again and watch afresh. */
  onSourcesChanged: () => void;
  /** @default () => new Date() */
  now?: () => Date;
}

/**
 * Every market's bars, names and live bars, from the sources the user's settings pick; weekly and
 * monthly bars are merged here from daily ones, for history and the live bar alike. Reopens the
 * live stream whenever the sources say it changed, and tells windows so.
 */
export function createMarketData({
  sources,
  onSourcesChanged,
  now = () => new Date(),
}: MarketDataOptions) {
  const live = createLiveCandles({
    openStream: () => sources.openStream(),
    async dailyCandles(request) {
      const provider = await sources.provider(request.symbol.market);

      return provider ? provider.getCandles(request) : [];
    },
    now,
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
    live.restart().catch(console.error);
    onSourcesChanged();
  });

  return {
    async candles(symbol: SymbolRef, interval: Interval): Promise<Candle[]> {
      const provider = await providerOf(symbol.market);
      const { from, to } = lookbackRange(symbol.market, interval, now());

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
    },

    async listing(symbol: SymbolRef): Promise<Listing | null> {
      const provider = await sources.provider(symbol.market);

      return provider ? provider.getListing(symbol) : null;
    },

    /** Starts pushing `sender` today's bars of `symbol`; false when no live stream covers it. */
    watch: (sender: LiveSender, symbol: SymbolRef, interval: Interval) =>
      live.watch(sender, symbol, interval),

    unwatch: (sender: LiveSender, symbol: SymbolRef, interval: Interval) =>
      live.unwatch(sender, symbol, interval),

    status: () => sources.status(),

    signInFubon: () => sources.signInFubon(),
  };
}

export type MarketDataModule = ReturnType<typeof createMarketData>;
