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

import { createLiveCandles } from "../src/modules/market/live-candles.ts";
import type {
  LiveCandle,
  LiveSender,
} from "../src/modules/market/live-candles.ts";
import { createLiveStream } from "../src/modules/market/live-stream.ts";

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
    watchDepth: () => undefined,
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

function fakeSender() {
  const received: LiveCandle[][] = [];

  const sender: LiveSender = {
    send(updates) {
      received.push(updates);
    },
  };

  const bars = () => received.flat().map((update) => update.candle);

  return { sender, received, bars };
}

function setup(today = "2026-09-29") {
  const streams = [fakeStream()];
  const dailyRequests: CandleRequest[] = [];

  const stream = createLiveStream(async () => streams.at(-1)?.stream);

  const live = createLiveCandles({
    stream,
    dailyCandles: async (request) => {
      dailyRequests.push(request);

      return [minute("00:00", 90, "2026-09-28")];
    },
    now: () => new Date(`${today}T10:00:00+08:00`),
  });

  return {
    live,
    restart: () => stream.restart(),
    streams,
    dailyRequests,
    stream: () => streams[0],
  };
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

  test("a symbol stays live until its last watch ends", async () => {
    const { live, stream } = setup();
    const first = fakeSender();
    const second = fakeSender();

    await live.watch(first.sender, TSMC, Interval.OneMinute);
    await live.watch(second.sender, TSMC, Interval.OneDay);
    live.unwatch(first.sender, TSMC);

    expect(stream().listeners.has("2330")).toBe(true);

    live.unwatch(second.sender, TSMC);

    expect(stream().listeners.has("2330")).toBe(false);
  });

  test("following yields an empty batch once covered, then the bars, and lets go as it stops", async () => {
    const { live, stream } = setup();
    const following = live.follow(TSMC, Interval.OneMinute);

    await expect(following.next()).resolves.toEqual({
      done: false,
      value: [],
    });

    stream()
      .listener()
      .onSession([minute("09:00", 10)]);
    vi.advanceTimersByTime(250);

    await expect(following.next()).resolves.toEqual({
      done: false,
      value: [minute("09:00", 10)],
    });

    await following.return(undefined);

    expect(stream().listeners.has("2330")).toBe(false);
  });

  test("following a symbol no stream takes ends at once", async () => {
    const { live } = setup();

    await expect(
      live
        .follow({ market: Market.US, symbol: "AAPL" }, Interval.OneMinute)
        .next()
    ).resolves.toEqual({ done: true, value: undefined });
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
      stream: createLiveStream(async () => undefined),
      dailyCandles: async () => [],
    });

    expect(
      await live.watch(fakeSender().sender, TSMC, Interval.OneMinute)
    ).toBe(false);
  });

  test("a restart while the stream opens closes the stale stream and watches on the new one", async () => {
    const stale = fakeStream();
    const current = fakeStream();
    let answer: (stream: MarketDataStream) => void = () => undefined;
    let opened = 0;

    const held = new Promise<MarketDataStream>((resolve) => {
      answer = resolve;
    });

    const stream = createLiveStream(async () => {
      opened += 1;

      return opened === 1 ? held : current.stream;
    });

    const live = createLiveCandles({ stream, dailyCandles: async () => [] });
    const watching = live.watch(fakeSender().sender, TSMC, Interval.OneMinute);

    await stream.restart();
    answer(stale.stream);

    expect(await watching).toBe(true);
    expect(stale.isClosed()).toBe(true);
    expect(stale.listeners.size).toBe(0);
    expect(current.listeners.has("2330")).toBe(true);
  });

  test("a stream that failed to open is opened again by the next watch", async () => {
    const { stream } = fakeStream();
    let opened = 0;

    const live = createLiveCandles({
      stream: createLiveStream(async () => {
        opened += 1;

        if (opened === 1) throw new Error("offline");

        return stream;
      }),
      dailyCandles: async () => [],
    });

    await expect(
      live.watch(fakeSender().sender, TSMC, Interval.OneMinute)
    ).rejects.toThrow("offline");
    expect(
      await live.watch(fakeSender().sender, TSMC, Interval.OneMinute)
    ).toBe(true);
  });

  test("a symbol the restarted stream refuses ends the watches that followed it", async () => {
    const { live, restart, streams } = setup();
    const following = live.follow(TSMC, Interval.OneMinute);

    expect((await following.next()).value).toEqual([]);

    const refusing = fakeStream();

    refusing.stream.watchMinutes = () => undefined;
    streams.push(refusing);

    const next = following.next();

    await restart();

    expect(await next).toEqual({ done: true, value: undefined });
  });

  test("a restart watches every symbol again on a new stream", async () => {
    const { live, restart, streams } = setup();

    await live.watch(fakeSender().sender, TSMC, Interval.OneMinute);
    streams.push(fakeStream());
    await restart();

    expect(streams[0].isClosed()).toBe(true);
    expect(streams[0].listeners.has("2330")).toBe(false);
    expect(streams[1].listeners.has("2330")).toBe(true);
  });
});
