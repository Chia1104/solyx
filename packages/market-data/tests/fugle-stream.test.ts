import { noop } from "es-toolkit";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import type { Candle } from "@solyx/core/candles";
import { Market } from "@solyx/core/market";
import type { Depth, MinuteListener } from "@solyx/core/market-data";

import type { StreamSocket } from "../src/fugle-api.ts";
import { createFugleStream } from "../src/fugle.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

const HON_HAI = { market: Market.TW, symbol: "2317" };

type ServerBar = ReturnType<typeof bar>;

type ServerQuote = ReturnType<typeof aggregate>;

/** The payload fields of Fugle's server events that these tests play. */
interface ServerData extends Partial<ServerBar>, Partial<ServerQuote> {
  message?: string;
  id?: string;
  channel?: string;
  symbol?: string;
  timeframe?: string;
  time?: number;
  data?: ServerBar[];
}

interface Sent {
  event: string;
  data: Record<string, string>;
}

/** Records what the stream sends and lets a test play the server's side. */
class FakeSocket implements StreamSocket {
  readonly sent: Sent[] = [];
  closed = false;
  private readonly handlers = new Map<
    string,
    ((event: { data?: unknown }) => void)[]
  >();

  addEventListener(
    type: "open" | "close" | "message",
    listener: (event: { data?: unknown }) => void
  ) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), listener]);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.closed = true;
    this.emit("close");
  }

  emit(type: "open" | "close" | "message", data?: string) {
    for (const handler of this.handlers.get(type) ?? []) handler({ data });
  }

  receive(event: string, data: ServerData, channel?: string) {
    this.emit("message", JSON.stringify({ event, data, channel }));
  }

  /** Opens, authenticates and confirms a bars subscription per symbol, as Fugle does. */
  accept(...symbols: string[]) {
    this.emit("open");
    this.receive("authenticated", { message: "Authenticated successfully" });

    for (const symbol of symbols) this.subscribed("candles", symbol);
  }

  subscribed(channel: string, symbol: string) {
    this.receive("subscribed", {
      id: `${channel}-${symbol}`,
      channel,
      symbol,
    });
  }
}

function bar(clock: string, close: number, volume: number) {
  return {
    date: `2026-09-29T${clock}:00.000+08:00`,
    open: close,
    high: close,
    low: close,
    close,
    volume,
    average: close,
  };
}

/** A session so far as the aggregates channel serves it, sizes in board lots. */
function aggregate(symbol: string, last: number) {
  return {
    date: "2026-09-29",
    type: "EQUITY",
    exchange: "TWSE",
    market: "TSE",
    symbol,
    name: "台積電",
    referencePrice: 2460,
    previousClose: 2460,
    openPrice: 2470,
    highPrice: 2485,
    lowPrice: 2465,
    closePrice: last,
    avgPrice: 2476.5,
    bids: [
      { price: last - 5, size: 87 },
      { price: last - 10, size: 245 },
    ],
    asks: [{ price: last, size: 80 }],
    total: {
      tradeValue: 31_019_803_000,
      tradeVolume: 12_538,
      tradeVolumeAtBid: 5_853,
      tradeVolumeAtAsk: 6_400,
      transaction: 9_530,
      time: 1_790_643_600_000_000,
    },
    lastUpdated: 1_790_643_600_123_456,
  };
}

function recorder() {
  const sessions: Candle[][] = [];
  const minutes: Candle[] = [];

  const listener: MinuteListener = {
    onSession: (session) => sessions.push(session),
    onMinute: (minute) => minutes.push(minute),
  };

  return { listener, sessions, minutes };
}

function setup() {
  const sockets: FakeSocket[] = [];

  const stream = createFugleStream({
    apiKey: "test-key",
    connect: () => {
      const socket = new FakeSocket();

      sockets.push(socket);

      return socket;
    },
  });

  const socket = () => {
    const current = sockets.at(-1);

    if (!current) throw new Error("No socket was opened");

    return current;
  };

  return { stream, sockets, socket };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test("authenticates, then subscribes the watched symbols", () => {
  const { stream, socket } = setup();

  stream.watchMinutes(TSMC, recorder().listener);
  socket().emit("open");

  expect(socket().sent).toEqual([
    { event: "auth", data: { apikey: "test-key" } },
  ]);

  socket().receive("authenticated", {});

  expect(socket().sent.at(-1)).toEqual({
    event: "subscribe",
    data: { channel: "candles", symbol: "2330" },
  });
});

test("snapshots and pushes arrive as minute bars counted in shares", () => {
  const { stream, socket } = setup();
  const { listener, sessions, minutes } = recorder();

  stream.watchMinutes(TSMC, listener);
  socket().accept("2330");
  socket().receive(
    "snapshot",
    { symbol: "2330", timeframe: "1", data: [bar("09:00", 2475, 4937)] },
    "candles"
  );
  socket().receive(
    "data",
    { symbol: "2330", ...bar("09:01", 2480, 12) },
    "candles"
  );

  expect(sessions).toEqual([
    [
      {
        time: Date.parse("2026-09-29T01:00:00Z") / 1000,
        open: 2475,
        high: 2475,
        low: 2475,
        close: 2475,
        volume: 4_937_000,
      },
    ],
  ]);
  expect(minutes.map((minute) => minute.volume)).toEqual([12_000]);
});

test("the last watcher of a symbol unsubscribes it, and the last symbol closes the connection", () => {
  const { stream, socket } = setup();
  const stopTsmc = stream.watchMinutes(TSMC, recorder().listener);
  const stopHonHai = stream.watchMinutes(HON_HAI, recorder().listener);

  socket().accept("2330", "2317");
  stopHonHai?.();

  expect(socket().sent.at(-1)).toEqual({
    event: "unsubscribe",
    data: { id: "candles-2317" },
  });

  stopTsmc?.();

  expect(socket().closed).toBe(true);
});

test("a dropped connection reconnects and subscribes again, and its snapshot refills the session", () => {
  const { stream, sockets, socket } = setup();
  const { listener, sessions } = recorder();

  stream.watchMinutes(TSMC, listener);
  socket().accept("2330");
  socket().close();

  expect(sockets).toHaveLength(1);

  vi.advanceTimersByTime(1_000);

  expect(sockets).toHaveLength(2);

  socket().accept();

  expect(socket().sent.at(-1)).toEqual({
    event: "subscribe",
    data: { channel: "candles", symbol: "2330" },
  });

  socket().receive(
    "snapshot",
    { symbol: "2330", data: [bar("09:00", 2475, 1)] },
    "candles"
  );

  expect(sessions).toHaveLength(1);
});

test("silence past two heartbeats counts as a lost connection", () => {
  const { stream, sockets, socket } = setup();

  stream.watchMinutes(TSMC, recorder().listener);
  socket().accept("2330");
  vi.advanceTimersByTime(30_000);
  socket().receive("heartbeat", { time: 1 });
  vi.advanceTimersByTime(74_000);

  expect(sockets[0].closed).toBe(false);

  vi.advanceTimersByTime(1_000);

  expect(sockets[0].closed).toBe(true);

  vi.advanceTimersByTime(1_000);

  expect(sockets).toHaveLength(2);
});

test("a refused key stops reconnecting", () => {
  const { stream, sockets, socket } = setup();

  stream.watchMinutes(TSMC, recorder().listener);
  socket().emit("open");
  socket().receive("error", { message: "Invalid authentication credentials" });
  vi.advanceTimersByTime(120_000);

  expect(sockets).toHaveLength(1);
  expect(sockets[0].closed).toBe(true);
});

test("symbols past the plan's capacity and other markets are refused", () => {
  const { stream } = setup();

  for (const symbol of ["2330", "2317", "2454", "2303", "2412"]) {
    expect(
      stream.watchMinutes({ market: Market.TW, symbol }, recorder().listener)
    ).toBeTypeOf("function");
  }

  expect(
    stream.watchMinutes(
      { market: Market.TW, symbol: "2881" },
      recorder().listener
    )
  ).toBeUndefined();
  expect(
    stream.watchMinutes(
      { market: Market.US, symbol: "AAPL" },
      recorder().listener
    )
  ).toBeUndefined();
});

test("depth arrives whole and in shares, its symbol subscribed once on its own channel", () => {
  const { stream, socket } = setup();
  const depths: Depth[] = [];

  stream.watchDepth(TSMC, (depth) => depths.push(depth));
  socket().accept();

  expect(socket().sent.at(-1)).toEqual({
    event: "subscribe",
    data: { channel: "aggregates", symbol: "2330" },
  });

  stream.watchDepth(TSMC, noop);

  expect(
    socket().sent.filter(({ event }) => event === "subscribe")
  ).toHaveLength(1);

  socket().receive("data", aggregate("2330", 2480), "aggregates");

  expect(depths).toEqual([
    {
      date: "2026-09-29",
      time: 1_790_643_600_123,
      reference: 2460,
      open: 2470,
      high: 2485,
      low: 2465,
      last: 2480,
      average: 2476.5,
      volume: 12_538_000,
      volumeAtBid: 5_853_000,
      volumeAtAsk: 6_400_000,
      bids: [
        { price: 2475, shares: 87_000 },
        { price: 2470, shares: 245_000 },
      ],
      asks: [{ price: 2480, shares: 80_000 }],
      trial: false,
    },
  ]);
});

test("a symbol's bars and its depth take a subscription each, and each unsubscribes its own", () => {
  const { stream, socket } = setup();
  const stopBars = stream.watchMinutes(TSMC, recorder().listener);
  const stopDepth = stream.watchDepth(TSMC, noop);

  for (const symbol of ["2317", "2454", "2303"]) {
    expect(
      stream.watchMinutes({ market: Market.TW, symbol }, recorder().listener)
    ).toBeTypeOf("function");
  }

  expect(stream.watchDepth(HON_HAI, noop)).toBeUndefined();

  socket().accept("2330");
  socket().subscribed("aggregates", "2330");
  stopDepth?.();

  expect(socket().sent.at(-1)).toEqual({
    event: "unsubscribe",
    data: { id: "aggregates-2330" },
  });

  stopBars?.();

  expect(socket().sent.at(-1)).toEqual({
    event: "unsubscribe",
    data: { id: "candles-2330" },
  });
});
