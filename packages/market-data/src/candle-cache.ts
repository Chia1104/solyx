import {
  Interval,
  isCalendarInterval,
  isIntraday,
  periodStart,
  resampleDaily,
} from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import { exchangeDate, shiftDate } from "@solyx/core/market";
import type {
  CandleRequest,
  MarketDataProvider,
} from "@solyx/core/market-data";
import type { CandleStore } from "@solyx/db/cache";

export interface CandleCacheOptions {
  /** @default () => new Date() */
  now?: () => Date;
}

/**
 * Serves bars from the cache and asks the provider only for what it lacks. Only closed
 * sessions are stored, since today's bars change until the close. Coverage ends at the
 * newest stored bar, so trailing holidays and sessions the provider has not published yet
 * are asked for again.
 */
export function withCandleCache(
  provider: MarketDataProvider,
  store: CandleStore,
  options: CandleCacheOptions = {}
): MarketDataProvider {
  const now = options.now ?? (() => new Date());

  async function barCandles({
    symbol,
    interval,
    from,
    to,
  }: CandleRequest): Promise<Candle[]> {
    const key = {
      source: provider.id,
      market: symbol.market,
      symbol: symbol.symbol,
      interval,
    };

    const today = exchangeDate(symbol.market, now());
    let covered = store.coverage(key);

    // Filling a gap after long disuse could mean months of minute bars, so a request that
    // starts past the covered span starts the series over.
    if (covered && from > shiftDate(covered.to, 1)) {
      store.remove(key);
      covered = undefined;
    }

    const ranges: [string, string][] = [];

    // Gaps are filled at both ends, so each series covers one contiguous span.
    if (covered === undefined) {
      ranges.push([from, to]);
    } else {
      if (from < covered.from) {
        ranges.push([from, shiftDate(covered.from, -1)]);
      }

      if (covered.to < to) {
        ranges.push([shiftDate(covered.to, 1), to]);
      }
    }

    const fetched = await Promise.all(
      ranges.map(([rangeFrom, rangeTo]) =>
        provider.getCandles({ symbol, interval, from: rangeFrom, to: rangeTo })
      )
    );

    const dated = fetched.flat().map((candle) => ({
      candle,
      date: exchangeDate(symbol.market, new Date(candle.time * 1000)),
    }));

    const closed = dated.filter(({ date }) => date < today);
    const newest = closed.at(-1)?.date ?? covered?.to;

    if (ranges.length > 0 && newest !== undefined) {
      store.store(key, closed, { from, to: newest });
    }

    const stored = store.read(key, from, to);
    const lastTime = stored.at(-1)?.time ?? -Infinity;

    // Intraday history is only ever charted over a recent window.
    if (isIntraday(interval)) store.trim(key, from);

    return [
      ...stored,
      ...dated
        .filter(({ date, candle }) => date >= today && candle.time > lastTime)
        .map(({ candle }) => candle),
    ];
  }

  return {
    id: provider.id,
    markets: provider.markets,

    getListing: (symbol) => provider.getListing(symbol),

    async getCandles(request) {
      if (!isCalendarInterval(request.interval)) return barCandles(request);

      // Weekly and monthly bars come from cached daily bars, never from requests of their own.
      const daily = await barCandles({
        ...request,
        interval: Interval.OneDay,
        from: periodStart(request.from, request.interval),
      });

      return resampleDaily(daily, request.interval, request.symbol.market);
    },
  };
}
