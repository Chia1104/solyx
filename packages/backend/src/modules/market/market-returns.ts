import {
  Interval,
  adjustedCandles,
  candleDate,
  lookbackRange,
} from "@solyx/core/candles";
import { symbolKey } from "@solyx/core/market";
import type { Market, SymbolRef } from "@solyx/core/market";
import type {
  MarketData,
  MarketReturns,
  ReturnClose,
  TotalReturnProvider,
} from "@solyx/core/market-data";
import { HOUR_MS } from "@solyx/utils/date";
import { freshFor, keepFresh } from "@solyx/utils/fresh";
import type { AnswerStores } from "@solyx/utils/fresh";

// A session's close comes out once, so a market is asked about twice a day at most.
const FRESH_MS = 12 * HOUR_MS;

export interface MarketReturnsOptions {
  /** One per market at most; the first that covers a market answers for it. */
  providers: readonly TotalReturnProvider[];
  /** Where each market's answer is kept between runs. */
  answers: AnswerStores;
  /** @default () => new Date() */
  now?: () => Date;
}

/**
 * Each market's index on total return over the daily bars' lookback, from the provider that
 * covers it, each answer kept twelve hours.
 */
export function createMarketReturns({
  providers,
  answers,
  now = () => new Date(),
}: MarketReturnsOptions): MarketReturns {
  const read = keepFresh<
    { market: Market; provider: TotalReturnProvider },
    ReturnClose[]
  >({
    store: answers("market-returns"),
    id: ({ market, provider }) => `${provider.id}:${market}`,
    ask: ({ market, provider }) =>
      provider.getTotalReturn(
        market,
        lookbackRange(market, Interval.OneDay, now()).from
      ),
    fresh: freshFor(FRESH_MS),
    now: () => now().getTime(),
  });

  return {
    closes(market) {
      const provider = providers.find(({ markets }) =>
        markets.includes(market)
      );

      if (!provider) {
        return Promise.reject(
          new Error(`No source covers the ${market} index on total return`)
        );
      }

      return read({ market, provider });
    },
  };
}

/**
 * A market's index on total return as a fund that tracks it returned: its own daily bars carried
 * over what it paid out, from their references, for a market whose index no source serves so.
 */
export function fundTotalReturn(
  marketData: Pick<MarketData, "candles">,
  fund: SymbolRef
): TotalReturnProvider {
  return {
    id: `fund:${symbolKey(fund)}`,
    markets: [fund.market],

    async getTotalReturn(market, since) {
      if (market !== fund.market) return [];

      const daily = await marketData.candles(fund, Interval.OneDay);

      return adjustedCandles(daily).flatMap((bar) => {
        const date = candleDate(market, bar.time);

        return date >= since ? [{ date, close: bar.close }] : [];
      });
    },
  };
}
