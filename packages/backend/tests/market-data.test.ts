import { noop } from "es-toolkit";
import { expect, test, vi } from "vite-plus/test";

import {
  Interval,
  lookbackRange,
  olderRange,
  periodStart,
} from "@solyx/core/candles";
import { Market } from "@solyx/core/market";
import type {
  MarketDataProvider,
  MarketDataStream,
} from "@solyx/core/market-data";
import {
  SectorGroup,
  TW_SECTOR_INDICES,
  TwSector,
  US_SECTOR_FUNDS,
  UsSector,
} from "@solyx/core/sectors";
import { weekdays } from "@solyx/core/session";
import { DAY_MS, MINUTE_MS } from "@solyx/utils/date";
import { memoryAnswers } from "@solyx/utils/fresh";

import type { MarketDataSources } from "../src/modules/market/market-data-sources.ts";
import { createMarketData } from "../src/modules/market/market-data.ts";

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
    watchDepth: () => undefined,
    close: () => {
      closed = true;
    },
  };

  return { stream, watched, isClosed: () => closed };
}

function setup() {
  const provider: MarketDataProvider = {
    id: "fake",
    markets: [Market.TW],
    getCandles: vi.fn(async () => []),
    getListing: vi.fn(async () => ({ name: "台積電", englishName: "TSMC" })),
    getQuote: vi.fn(async () => null),
    getDepth: vi.fn(async () => null),
  };

  const streams = [fakeStream()];
  const streamListeners = new Set<() => void>();
  const onSourcesChanged = vi.fn();

  const sources: MarketDataSources = {
    provider: async (market) => (market === Market.TW ? provider : undefined),
    openStream: async () => streams.at(-1)?.stream,
    status: vi.fn<MarketDataSources["status"]>(),
    signInFubon: vi.fn<MarketDataSources["signInFubon"]>(),
    longbridgeCalendar: async () => undefined,
    usListings: vi.fn<MarketDataSources["usListings"]>(async () => [
      { symbol: "AAPL", name: "蘋果", englishName: "Apple Inc." },
    ]),
    signInLongbridge: vi.fn<MarketDataSources["signInLongbridge"]>(),
    cancelLongbridgeSignIn:
      vi.fn<MarketDataSources["cancelLongbridgeSignIn"]>(),
    signOutLongbridge: vi.fn<MarketDataSources["signOutLongbridge"]>(),
    fubonSession: vi.fn<MarketDataSources["fubonSession"]>(),
    onStreamChange(listener) {
      streamListeners.add(listener);

      return () => {
        streamListeners.delete(listener);
      };
    },
    onFubonChange: () => noop,
  };

  const clock = { now: NOW };

  const marketData = createMarketData({
    sources,
    marketDays: async () => weekdays,
    answers: memoryAnswers(),
    diagnostics: { recovered: vi.fn() },
    onSourcesChanged,
    now: () => clock.now,
  });

  // The sources say the stream they would open changed, as after a new key or source.
  function changeStream(next = fakeStream()) {
    streams.push(next);

    for (const listener of streamListeners) listener();

    return next;
  }

  return {
    marketData,
    provider,
    sources,
    streams,
    onSourcesChanged,
    changeStream,
    clock,
  };
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

test("a page of older bars ends the day before the oldest bar's session", async () => {
  const { marketData, provider } = setup();
  const before = taipei("2026-03-02");

  await marketData.olderCandles(TSMC, Interval.OneDay, before);

  expect(provider.getCandles).toHaveBeenCalledWith({
    symbol: TSMC,
    interval: Interval.OneDay,
    ...olderRange(Market.TW, Interval.OneDay, before),
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

test("bars from a day on reach back to it where it lies before the lookback, and never read less than the lookback", async () => {
  const { marketData, provider } = setup();
  const lookback = lookbackRange(Market.TW, Interval.OneDay, NOW);

  await marketData.candlesSince(TSMC, Interval.OneDay, "2018-01-02");
  await marketData.candlesSince(TSMC, Interval.OneDay, "2026-09-01");

  expect(vi.mocked(provider.getCandles).mock.calls).toEqual([
    [
      {
        symbol: TSMC,
        interval: Interval.OneDay,
        from: "2018-01-02",
        to: lookback.to,
      },
    ],
    [{ symbol: TSMC, interval: Interval.OneDay, ...lookback }],
  ]);
});

test("the US directory is read once a day while US data is signed in, and not at all while signed out", async () => {
  const { marketData, sources, clock } = setup();

  expect(await marketData.listingDirectory(Market.US)).toEqual([]);
  expect(sources.usListings).not.toHaveBeenCalled();

  const us: MarketDataProvider = {
    id: "longbridge",
    markets: [Market.US],
    getCandles: async () => [],
    getListing: async () => null,
    getQuote: async () => null,
    getDepth: async () => null,
  };

  sources.provider = async (market) => (market === Market.US ? us : undefined);

  const listed = [{ symbol: "AAPL", name: "蘋果", englishName: "Apple Inc." }];

  expect(await marketData.listingDirectory(Market.US)).toEqual(listed);

  clock.now = new Date(NOW.getTime() + DAY_MS - 1);
  await marketData.listingDirectory(Market.US);

  expect(sources.usListings).toHaveBeenCalledOnce();

  clock.now = new Date(NOW.getTime() + DAY_MS);
  await marketData.listingDirectory(Market.US);

  expect(sources.usListings).toHaveBeenCalledTimes(2);
  // Taiwan's names come from its exchanges' lists instead.
  expect(await marketData.listingDirectory(Market.TW)).toEqual([]);
});

test("sectors quote each sector index once", async () => {
  const { marketData, provider } = setup();

  vi.mocked(provider.getQuote).mockImplementation(async ({ symbol }) =>
    symbol === "IX0028"
      ? { date: "2026-09-29", last: 1212, reference: 1200, tradeValue: 9e10 }
      : null
  );

  const sectors = await marketData.sectors(Market.TW);

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

test("sectors read within a minute share one read of the indices", async () => {
  const { marketData, provider, clock } = setup();

  await marketData.sectors(Market.TW);

  clock.now = new Date(NOW.getTime() + MINUTE_MS - 1);
  await marketData.sectors(Market.TW);

  expect(provider.getQuote).toHaveBeenCalledTimes(TW_SECTOR_INDICES.length);

  clock.now = new Date(NOW.getTime() + MINUTE_MS);
  await marketData.sectors(Market.TW);

  expect(provider.getQuote).toHaveBeenCalledTimes(2 * TW_SECTOR_INDICES.length);
});

test("the US's sectors are its sector funds, quoted from its own source and kept apart from Taiwan's", async () => {
  const { marketData, sources, provider } = setup();

  expect(await marketData.sectors(Market.US)).toBeNull();

  const us: MarketDataProvider = {
    id: "longbridge",
    markets: [Market.US],
    getCandles: async () => [],
    getListing: async () => null,
    getQuote: vi.fn<MarketDataProvider["getQuote"]>(async ({ symbol }) =>
      symbol === "XLK"
        ? { date: "2026-09-29", last: 250, reference: 245, tradeValue: 3e9 }
        : null
    ),
    getDepth: async () => null,
  };

  sources.provider = async (market) => (market === Market.US ? us : provider);

  await marketData.sectors(Market.TW);
  const sectors = await marketData.sectors(Market.US);

  expect(us.getQuote).toHaveBeenCalledTimes(US_SECTOR_FUNDS.length);
  expect(vi.mocked(us.getQuote).mock.calls.map(([symbol]) => symbol)).toEqual(
    US_SECTOR_FUNDS.map(({ symbol }) => ({ market: Market.US, symbol }))
  );
  expect(provider.getQuote).toHaveBeenCalledTimes(TW_SECTOR_INDICES.length);
  expect(sectors?.find((each) => each.symbol === "XLK")).toEqual({
    sector: UsSector.Technology,
    group: SectorGroup.Sensitive,
    symbol: "XLK",
    quote: { date: "2026-09-29", last: 250, reference: 245, tradeValue: 3e9 },
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

test("a listing's names are asked for once found, and again after a miss", async () => {
  const { marketData, provider } = setup();
  const getListing = vi.mocked(provider.getListing);

  getListing.mockResolvedValueOnce(null);

  expect(await marketData.listing(TSMC)).toBeNull();
  expect(await marketData.listing(TSMC)).toEqual({
    name: "台積電",
    englishName: "TSMC",
  });
  await marketData.listing(TSMC);

  expect(getListing).toHaveBeenCalledTimes(2);
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

  const following = marketData.liveCandles(TSMC, Interval.OneMinute);

  await expect(following.next()).resolves.toEqual({ done: false, value: [] });

  const next = changeStream();

  expect(onSourcesChanged).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(next.watched.has("2330")).toBe(true));
  expect(streams[0].isClosed()).toBe(true);

  await following.return(undefined);
});

test("a symbol the new stream refuses stops being live, which watching again tells", async () => {
  const { marketData, changeStream } = setup();

  const following = marketData.liveCandles(TSMC, Interval.OneMinute);

  await following.next();

  const next = changeStream(fakeStream(0));

  // Windows follow again once told, as the renderer does; no live stream covers it now.
  await expect(
    marketData.liveCandles(TSMC, Interval.OneMinute).next()
  ).resolves.toEqual({ done: true, value: undefined });
  expect(next.watched.size).toBe(0);

  await following.return(undefined);
});
