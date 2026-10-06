import { expect, test, vi } from "vite-plus/test";

import { Interval, lookbackRange, periodStart } from "@solyx/core/candles";
import { Market } from "@solyx/core/market";
import type {
  MarketDataProvider,
  MarketDataStream,
} from "@solyx/core/market-data";
import { SectorGroup, TW_SECTOR_INDICES, TwSector } from "@solyx/core/sectors";

import type { LiveSender } from "../src/main/modules/market/live-candles.ts";
import type { MarketDataSources } from "../src/main/modules/market/market-data-sources.ts";
import { createMarketData } from "../src/main/modules/market/market-data.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

const NOW = new Date("2026-09-29T10:00:00+08:00");

const taipei = (date: string) => Date.parse(`${date}T00:00:00+08:00`) / 1000;

/** A stream that takes as many symbols as `room` allows. */
function fakeStream(room = Infinity) {
  const watched = new Set<string>();
  let closed = false;

  const stream: MarketDataStream = {
    id: "fake",
    markets: [Market.TW],
    watchMinutes(symbol) {
      if (watched.size >= room) return undefined;

      watched.add(symbol.symbol);

      return () => watched.delete(symbol.symbol);
    },
    close: () => {
      closed = true;
    },
  };

  return { stream, watched, isClosed: () => closed };
}

const sender: LiveSender = {
  id: 1,
  send: () => undefined,
  once: () => undefined,
};

function setup() {
  const provider: MarketDataProvider = {
    id: "fake",
    markets: [Market.TW],
    getCandles: vi.fn(async () => []),
    getListing: vi.fn(async () => ({ name: "台積電", englishName: "TSMC" })),
    getQuote: vi.fn(async () => null),
  };

  const streams = [fakeStream()];
  const streamListeners = new Set<() => void>();
  const onSourcesChanged = vi.fn();

  const sources: MarketDataSources = {
    provider: async (market) => (market === Market.TW ? provider : undefined),
    openStream: async () => streams.at(-1)?.stream,
    status: vi.fn<MarketDataSources["status"]>(),
    signInFubon: vi.fn<MarketDataSources["signInFubon"]>(),
    onStreamChange(listener) {
      streamListeners.add(listener);

      return () => {
        streamListeners.delete(listener);
      };
    },
  };

  const marketData = createMarketData({
    sources,
    onSourcesChanged,
    now: () => NOW,
  });

  // The sources say the stream they would open changed, as after a new key or source.
  function changeStream(next = fakeStream()) {
    streams.push(next);

    for (const listener of streamListeners) listener();

    return next;
  }

  return { marketData, provider, streams, onSourcesChanged, changeStream };
}

test("bars reach back the interval's lookback, from the market's source", async () => {
  const { marketData, provider } = setup();

  await marketData.candles(TSMC, Interval.OneDay);

  expect(provider.getCandles).toHaveBeenCalledWith({
    symbol: TSMC,
    interval: Interval.OneDay,
    ...lookbackRange(Market.TW, Interval.OneDay, NOW),
  });
  expect(await marketData.listing(TSMC)).toEqual({
    name: "台積電",
    englishName: "TSMC",
  });
});

test("a quote reads the five-minute bars a chart of that interval reads", async () => {
  const { marketData, provider } = setup();

  vi.mocked(provider.getCandles).mockResolvedValue([
    {
      time: taipei("2026-09-26") + 13 * 3600,
      open: 1,
      high: 1,
      low: 1,
      close: 1070,
      volume: 1,
    },
    {
      time: taipei("2026-09-29") + 9 * 3600,
      open: 1,
      high: 1,
      low: 1,
      close: 1085,
      volume: 1,
    },
  ]);

  const quote = await marketData.quote(TSMC);

  expect(provider.getCandles).toHaveBeenCalledWith({
    symbol: TSMC,
    interval: Interval.FiveMinutes,
    ...lookbackRange(Market.TW, Interval.FiveMinutes, NOW),
  });
  expect(quote).toMatchObject({
    date: "2026-09-29",
    last: 1085,
    previousClose: 1070,
  });
  expect(await marketData.quote({ market: Market.US, symbol: "AAPL" })).toBe(
    null
  );
});

test("sectors quote each sector index once", async () => {
  const { marketData, provider } = setup();

  vi.mocked(provider.getQuote).mockImplementation(async ({ symbol }) =>
    symbol === "IX0028"
      ? { date: "2026-09-29", last: 1212, reference: 1200, tradeValue: 9e10 }
      : null
  );

  const sectors = await marketData.sectors();

  expect(provider.getQuote).toHaveBeenCalledTimes(TW_SECTOR_INDICES.length);
  expect(sectors?.find((each) => each.symbol === "IX0028")).toEqual({
    sector: TwSector.Semiconductors,
    group: SectorGroup.Electronics,
    symbol: "IX0028",
    quote: {
      date: "2026-09-29",
      last: 1212,
      reference: 1200,
      tradeValue: 9e10,
    },
  });
});

test("weekly bars merge whole weeks of the source's daily bars", async () => {
  const { marketData, provider } = setup();

  vi.mocked(provider.getCandles).mockResolvedValue(
    ["2026-08-31", "2026-09-04", "2026-09-07", "2026-09-29"].map(
      (date, close) => ({
        time: taipei(date),
        open: close,
        high: close,
        low: close,
        close,
        volume: 1000,
      })
    )
  );

  const weeks = await marketData.candles(TSMC, Interval.OneWeek);
  const { from, to } = lookbackRange(Market.TW, Interval.OneWeek, NOW);

  expect(provider.getCandles).toHaveBeenCalledWith({
    symbol: TSMC,
    interval: Interval.OneDay,
    from: periodStart(from, Interval.OneWeek),
    to,
  });
  expect(weeks.map((week) => [week.time, week.close, week.volume])).toEqual([
    [taipei("2026-08-31"), 1, 2000],
    [taipei("2026-09-07"), 2, 1000],
    // A week opens with its first session.
    [taipei("2026-09-29"), 3, 1000],
  ]);
});

test("a market without a source is reported, not guessed", async () => {
  const { marketData } = setup();
  const apple = { market: Market.US, symbol: "AAPL" };

  await expect(marketData.candles(apple, Interval.OneDay)).rejects.toThrow(
    "No market data for US"
  );
  expect(await marketData.listing(apple)).toBeNull();
});

test("a stream change reopens the stream, keeps watched symbols live and tells windows", async () => {
  const { marketData, streams, onSourcesChanged, changeStream } = setup();

  expect(await marketData.watch(sender, TSMC, Interval.OneMinute)).toBe(true);

  const next = changeStream();

  expect(onSourcesChanged).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(next.watched.has("2330")).toBe(true));
  expect(streams[0].isClosed()).toBe(true);
});

test("a symbol the new stream refuses stops being live, which watching again tells", async () => {
  const { marketData, changeStream } = setup();

  await marketData.watch(sender, TSMC, Interval.OneMinute);

  const next = changeStream(fakeStream(0));

  // Windows watch again once told, as the renderer does.
  expect(await marketData.watch(sender, TSMC, Interval.OneMinute)).toBe(false);
  expect(next.watched.size).toBe(0);
});
