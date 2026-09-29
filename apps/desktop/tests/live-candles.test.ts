import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { Interval } from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import { Market } from "@solyx/core/market";
import type {
  CandleRequest,
  MarketDataStream,
  MinuteListener,
} from "@solyx/core/market-data";

import { marketEvents } from "#shared/ipc/market.ts";
import type { LiveCandle } from "#shared/ipc/market.ts";

import { createLiveCandles } from "../src/main/modules/market/live-candles.ts";
import type { LiveSender } from "../src/main/modules/market/live-candles.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

function minute(clock: string, close: number, date = "2026-09-29"): Candle {
  return {
    time: Date.parse(`${date}T${clock}:00+08:00`) / 1000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
  };
}

function fakeStream() {
  const listeners = new Map<string, MinuteListener>();
  let closed = false;

  const stream: MarketDataStream = {
    id: "fake",
    markets: [Market.TW],
    watchMinutes(symbol, listener) {
      if (symbol.market !== Market.TW) return undefined;

      listeners.set(symbol.symbol, listener);

      return () => listeners.delete(symbol.symbol);
    },
    close: () => {
      closed = true;
    },
  };

  const listener = (symbol = "2330") => {
    const found = listeners.get(symbol);

    if (!found) throw new Error(`${symbol} is not watched`);

    return found;
  };

  return { stream, listeners, listener, isClosed: () => closed };
}

let nextSenderId = 1;

function fakeSender() {
  const received: LiveCandle[][] = [];
  const onDestroyed: (() => void)[] = [];

  const sender: LiveSender = {
    id: nextSenderId++,
    send(channel, updates) {
      expect(channel).toBe(marketEvents.onLiveCandles);
      received.push(updates);
    },
    once(_event, listener) {
      onDestroyed.push(listener);
    },
  };

  const destroy = () => {
    for (const listener of onDestroyed) listener();
  };

  const bars = () => received.flat().map((update) => update.candle);

  return { sender, received, bars, destroy };
}

function setup(today = "2026-09-29") {
  const streams = [fakeStream()];
  const dailyRequests: CandleRequest[] = [];

  const live = createLiveCandles({
    openStream: async () => streams.at(-1)?.stream,
    dailyCandles: async (request) => {
      dailyRequests.push(request);

      return [minute("00:00", 90, "2026-09-28")];
    },
    now: () => new Date(`${today}T10:00:00+08:00`),
  });

  return { live, streams, dailyRequests, stream: () => streams[0] };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createLiveCandles", () => {
  test("pushes the watched interval's bars, coalescing a minute's updates", async () => {
    const { live, stream } = setup();
    const window = fakeSender();

    expect(await live.watch(window.sender, TSMC, Interval.FiveMinutes)).toBe(
      true
    );

    stream()
      .listener()
      .onSession([minute("09:00", 10), minute("09:01", 12)]);
    vi.advanceTimersByTime(250);

    expect(window.bars()).toEqual([
      { ...minute("09:00", 10), high: 12, close: 12, volume: 2000 },
    ]);

    window.received.length = 0;
    stream().listener().onMinute(minute("09:04", 13));
    stream().listener().onMinute(minute("09:04", 14));
    stream().listener().onMinute(minute("09:05", 15));
    vi.advanceTimersByTime(250);

    // The first push after a quiet spell goes out at once; the burst after it is one batch
    // holding the 09:00 bar's final state, then the new 09:05 bar.
    expect(window.received).toHaveLength(2);
    expect(
      window.received[1].map(({ candle }) => [candle.time, candle.close])
    ).toEqual([
      [minute("09:00", 0).time, 14],
      [minute("09:05", 0).time, 15],
    ]);
  });

  test("each window gets the interval it watches", async () => {
    const { live, stream } = setup();
    const intraday = fakeSender();
    const daily = fakeSender();

    await live.watch(intraday.sender, TSMC, Interval.OneMinute);
    await live.watch(daily.sender, TSMC, Interval.OneDay);
    stream()
      .listener()
      .onSession([minute("09:00", 10), minute("09:01", 12)]);
    vi.advanceTimersByTime(250);

    expect(intraday.bars()).toHaveLength(2);
    expect(daily.bars()).toEqual([
      {
        time: Date.parse("2026-09-29T00:00:00+08:00") / 1000,
        open: 10,
        high: 12,
        low: 10,
        close: 12,
        volume: 2000,
      },
    ]);
  });

  test("a new watch gets the whole session without resending it to the others", async () => {
    const { live, stream } = setup();
    const first = fakeSender();
    const second = fakeSender();

    await live.watch(first.sender, TSMC, Interval.OneMinute);
    stream()
      .listener()
      .onSession([minute("09:00", 10), minute("09:01", 12)]);
    vi.advanceTimersByTime(250);
    await live.watch(second.sender, TSMC, Interval.OneMinute);
    vi.advanceTimersByTime(250);

    expect(first.bars()).toHaveLength(2);
    expect(second.bars()).toHaveLength(2);
  });

  test("an earlier session is not pushed, since history already holds it", async () => {
    const { live, stream } = setup("2026-09-30");
    const window = fakeSender();

    await live.watch(window.sender, TSMC, Interval.OneMinute);
    stream()
      .listener()
      .onSession([minute("13:30", 10, "2026-09-29")]);
    vi.advanceTimersByTime(250);

    expect(window.received).toEqual([]);
  });

  test("weekly bars start from the week's closed sessions", async () => {
    const { live, stream, dailyRequests } = setup();
    const window = fakeSender();

    await live.watch(window.sender, TSMC, Interval.OneWeek);
    stream()
      .listener()
      .onSession([minute("09:00", 10)]);
    await vi.advanceTimersByTimeAsync(250);

    expect(dailyRequests).toEqual([
      {
        symbol: TSMC,
        interval: Interval.OneDay,
        from: "2026-09-28",
        to: "2026-09-28",
      },
    ]);
    expect(window.bars().at(-1)).toMatchObject({
      time: minute("00:00", 0, "2026-09-28").time,
      open: 90,
      close: 10,
      volume: 2000,
    });
  });

  test("watches are counted, so a remount's late unwatch keeps the new watch", async () => {
    const { live, stream } = setup();
    const window = fakeSender();

    await live.watch(window.sender, TSMC, Interval.OneMinute);
    await live.watch(window.sender, TSMC, Interval.OneMinute);
    live.unwatch(window.sender, TSMC, Interval.OneMinute);

    expect(stream().listeners.has("2330")).toBe(true);

    live.unwatch(window.sender, TSMC, Interval.OneMinute);

    expect(stream().listeners.has("2330")).toBe(false);
  });

  test("a closed window releases its watches", async () => {
    const { live, stream } = setup();
    const window = fakeSender();

    await live.watch(window.sender, TSMC, Interval.OneMinute);
    window.destroy();

    expect(stream().listeners.has("2330")).toBe(false);
  });

  test("symbols the stream cannot take are not live", async () => {
    const { live } = setup();

    expect(
      await live.watch(
        fakeSender().sender,
        { market: Market.US, symbol: "AAPL" },
        Interval.OneMinute
      )
    ).toBe(false);
  });

  test("without a stream nothing is live", async () => {
    const live = createLiveCandles({
      openStream: async () => undefined,
      dailyCandles: async () => [],
    });

    expect(
      await live.watch(fakeSender().sender, TSMC, Interval.OneMinute)
    ).toBe(false);
  });

  test("a restart watches every symbol again on a new stream", async () => {
    const { live, streams } = setup();

    await live.watch(fakeSender().sender, TSMC, Interval.OneMinute);
    streams.push(fakeStream());
    await live.restart();

    expect(streams[0].isClosed()).toBe(true);
    expect(streams[0].listeners.has("2330")).toBe(false);
    expect(streams[1].listeners.has("2330")).toBe(true);
  });
});
