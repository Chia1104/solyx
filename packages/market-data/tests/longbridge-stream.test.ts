import { BinaryReader, BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { Interval } from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import { Market } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type {
  CandleRequest,
  Depth,
  MinuteListener,
} from "@solyx/core/market-data";
import { weekdays } from "@solyx/core/session";
import type { TradingDays } from "@solyx/core/session";

import { createLongbridgeStream } from "../src/longbridge-stream.ts";
import { LongbridgeError } from "../src/longbridge.ts";
import type {
  LongbridgePushListener,
  LongbridgeSocket,
} from "../src/longbridge.ts";

const APPLE = { market: Market.US, symbol: "AAPL" };

const NOW = new Date("2026-10-28T14:35:00Z");

/** UTC seconds of a New York time on 2026-10-28, when New York is four hours behind. */
const at = (time: string) => Date.parse(`2026-10-28T${time}-04:00`) / 1000;

const Push = { Quote: 101, Depth: 102, Trade: 104 } as const;

const Request = { Subscribe: 6, Unsubscribe: 7 } as const;

afterEach(() => {
  vi.useRealTimers();
});

interface Sent {
  command: number;
  body: Uint8Array;
}

/** A subscribe or unsubscribe as the stream sent it. */
function subscription({ body }: Sent) {
  const reader = new BinaryReader(body);
  const symbols: string[] = [];
  const types: number[] = [];
  let first = false;

  while (reader.pos < reader.len) {
    const [field] = reader.tag();

    if (field === 1) symbols.push(reader.string());

    if (field === 2) {
      const packed = new BinaryReader(reader.bytes());

      while (packed.pos < packed.len) types.push(packed.int32());
    }

    if (field === 3) first = reader.bool();
  }

  return { symbols, types, first };
}

/** Plays a sign-in's connection: every request answered unless a test says otherwise. */
function fakeSocket() {
  const sent: Sent[] = [];
  const pushes = new Set<LongbridgePushListener>();
  const drops = new Set<() => void>();
  let refuse: ((sent: Sent) => Error | undefined) | undefined;

  const socket: LongbridgeSocket = {
    async request(command, body) {
      const request = { command, body };

      sent.push(request);

      const refusal = refuse?.(request);

      if (refusal) throw refusal;

      return new Uint8Array();
    },
    onPush(listener) {
      pushes.add(listener);

      return () => pushes.delete(listener);
    },
    onDrop(listener) {
      drops.add(listener);

      return () => drops.delete(listener);
    },
    close: () => undefined,
  };

  return {
    socket,
    sent,
    subscriptions: (command: number) =>
      sent.filter((request) => request.command === command).map(subscription),
    push(command: number, body: Uint8Array) {
      for (const listener of pushes) listener(command, body);
    },
    drop() {
      for (const listener of drops) listener();
    },
    refuse(next: typeof refuse) {
      refuse = next;
    },
  };
}

interface SaleFields {
  price: string;
  volume: number;
  timestamp: number;
  condition?: string;
  session?: number;
}

function trades(symbol: string, sales: SaleFields[]) {
  const writer = new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string(symbol);

  for (const {
    price,
    volume,
    timestamp,
    condition = "",
    session = 0,
  } of sales) {
    writer
      .tag(3, WireType.LengthDelimited)
      .fork()
      .tag(1, WireType.LengthDelimited)
      .string(price)
      .tag(2, WireType.Varint)
      .int64(volume)
      .tag(3, WireType.Varint)
      .int64(timestamp)
      .tag(4, WireType.LengthDelimited)
      .string(condition)
      .tag(6, WireType.Varint)
      .int32(session)
      .join();
  }

  return writer.finish();
}

/** A quote push; Longbridge leaves out each figure that did not change. */
function quotePush({
  last = "",
  open = "",
  high = "",
  low = "",
  volume = 0,
  turnover = "",
  timestamp,
  session = 0,
  tag = 0,
}: {
  last?: string;
  open?: string;
  high?: string;
  low?: string;
  volume?: number;
  turnover?: string;
  timestamp: number;
  session?: number;
  tag?: number;
}) {
  const writer = new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string("AAPL.US");

  for (const [field, text] of [
    [3, last],
    [4, open],
    [5, high],
    [6, low],
    [9, turnover],
  ] as const) {
    if (text !== "") writer.tag(field, WireType.LengthDelimited).string(text);
  }

  writer.tag(7, WireType.Varint).int64(timestamp);

  if (volume > 0) writer.tag(8, WireType.Varint).int64(volume);

  return writer
    .tag(11, WireType.Varint)
    .int32(session)
    .tag(14, WireType.Varint)
    .int32(tag)
    .finish();
}

interface Level {
  position: number;
  price: string;
  volume: number;
}

/** A book push carrying the levels that changed. */
function depthPush({
  bids = [],
  asks = [],
}: {
  bids?: Level[];
  asks?: Level[];
}) {
  const writer = new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string("AAPL.US");

  for (const [field, levels] of [
    [3, asks],
    [4, bids],
  ] as const) {
    for (const { position, price, volume } of levels) {
      writer
        .tag(field, WireType.LengthDelimited)
        .fork()
        .tag(1, WireType.Varint)
        .int32(position)
        .tag(2, WireType.LengthDelimited)
        .string(price)
        .tag(3, WireType.Varint)
        .int64(volume)
        .join();
    }
  }

  return writer.finish();
}

const bar = (time: number, price: number, volume: number): Candle => ({
  time,
  open: price,
  high: price,
  low: price,
  close: price,
  volume,
});

const DEPTH: Depth = {
  date: "2026-10-28",
  time: at("10:34:00") * 1000,
  reference: 98,
  open: 100,
  high: 101,
  low: 99,
  last: 100.5,
  average: 100.2,
  volume: 1_000,
  volumeAtBid: 0,
  volumeAtAsk: 0,
  bids: [{ price: 100.4, shares: 100 }],
  asks: [{ price: 100.6, shares: 100 }],
  trial: false,
};

function setup({
  session = [bar(at("10:34:00"), 100, 500)],
  depth = DEPTH,
  tradingDays = weekdays,
}: {
  session?: Candle[];
  depth?: Depth | null;
  tradingDays?: TradingDays;
} = {}) {
  const fake = fakeSocket();
  const asked: CandleRequest[] = [];

  const stream = createLongbridgeStream({
    socket: fake.socket,
    provider: {
      async getCandles(request) {
        asked.push(request);

        return session;
      },
      getDepth: async () => depth,
    },
    tradingDays: async () => tradingDays,
    now: () => NOW,
  });

  return { ...fake, asked, stream };
}

function minuteListener() {
  return {
    onSession: vi.fn<MinuteListener["onSession"]>(),
    onMinute: vi.fn<MinuteListener["onMinute"]>(),
  };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

test("starts a listing's bars from the session so far, then merges each regular sale into its minute", async () => {
  const { stream, asked, push, subscriptions } = setup();
  const listener = minuteListener();

  stream.watchMinutes(APPLE, listener);
  await settled();

  expect(asked).toEqual([
    {
      symbol: APPLE,
      interval: Interval.OneMinute,
      from: "2026-10-28",
      to: "2026-10-28",
    },
  ]);
  expect(listener.onSession).toHaveBeenCalledWith([
    bar(at("10:34:00"), 100, 500),
  ]);
  expect(subscriptions(Request.Subscribe)).toEqual([
    { symbols: ["AAPL.US"], types: [4], first: false },
  ]);

  push(
    Push.Trade,
    trades("AAPL.US", [
      { price: "101", volume: 10, timestamp: at("10:34:20") },
      { price: "99.5", volume: 20, timestamp: at("10:34:40") },
      // Before the open, and a late report, count toward no bar.
      { price: "90", volume: 5, timestamp: at("10:34:50"), session: 1 },
      { price: "80", volume: 5, timestamp: at("10:34:55"), condition: "Z" },
      { price: "100.25", volume: 30, timestamp: at("10:35:05") },
      // An odd lot adds its shares but not its price.
      { price: "120", volume: 3, timestamp: at("10:35:10"), condition: "I" },
    ])
  );

  expect(listener.onMinute.mock.calls.map(([minute]) => minute)).toEqual([
    {
      time: at("10:34:00"),
      open: 100,
      high: 101,
      low: 99.5,
      close: 99.5,
      volume: 530,
    },
    bar(at("10:35:00"), 100.25, 33),
  ]);
});

test("a sale counted only for its shares opens a bar at the close before, which the next priced sale prices afresh", async () => {
  const { stream, push } = setup();
  const listener = minuteListener();

  stream.watchMinutes(APPLE, listener);
  await settled();

  push(
    Push.Trade,
    trades("AAPL.US", [
      { price: "130", volume: 4, timestamp: at("10:35:01"), condition: "I" },
    ])
  );
  push(
    Push.Trade,
    trades("AAPL.US", [{ price: "102", volume: 6, timestamp: at("10:35:30") }])
  );

  expect(listener.onMinute.mock.calls.map(([minute]) => minute)).toEqual([
    bar(at("10:35:00"), 100, 4),
    bar(at("10:35:00"), 102, 10),
  ]);
});

test("no bar holds a sale from the close on, which comes at one o'clock on a day that closes early", async () => {
  const blackFriday: TradingDays = Object.assign(() => true, {
    closesEarly: (date: string) => date === "2026-11-27",
  });

  const { stream, push } = setup({ tradingDays: blackFriday });
  const listener = minuteListener();

  stream.watchMinutes(APPLE, listener);
  await settled();

  // New York is five hours behind by then.
  const friday = (time: string) =>
    Date.parse(`2026-11-27T${time}-05:00`) / 1000;

  push(
    Push.Trade,
    trades("AAPL.US", [
      { price: "105", volume: 7, timestamp: friday("12:59:30") },
      { price: "106", volume: 900, timestamp: friday("13:00:02") },
    ])
  );
  push(
    Push.Trade,
    trades("AAPL.US", [{ price: "104", volume: 9, timestamp: at("15:59:59") }])
  );

  // The later session started the bars over, so an earlier session's sale is stale.
  expect(listener.onMinute.mock.calls.map(([minute]) => minute)).toEqual([
    bar(friday("12:59:00"), 105, 7),
  ]);
});

test("a listener joining a listing watched already starts from its bars", async () => {
  const { stream, subscriptions } = setup();
  const first = minuteListener();
  const second = minuteListener();

  stream.watchMinutes(APPLE, first);
  await settled();
  stream.watchMinutes(APPLE, second);
  await settled();

  expect(second.onSession).toHaveBeenCalledWith([
    bar(at("10:34:00"), 100, 500),
  ]);
  expect(subscriptions(Request.Subscribe)).toHaveLength(1);
});

test("a book starts from its read and changes with each push, its session figures the regular session's", async () => {
  const { stream, push, subscriptions } = setup();
  const books: Depth[] = [];

  stream.watchDepth(APPLE, (depth) => books.push(depth));
  await settled();

  expect(subscriptions(Request.Subscribe)).toEqual([
    { symbols: ["AAPL.US"], types: [1, 2], first: true },
  ]);

  push(
    Push.Depth,
    depthPush({
      bids: [{ position: 1, price: "100.7", volume: 200 }],
      asks: [{ position: 1, price: "100.9", volume: 300 }],
    })
  );
  push(
    Push.Quote,
    quotePush({
      last: "100.8",
      high: "102",
      volume: 2_000,
      turnover: "202000",
      timestamp: at("10:35:00"),
    })
  );
  // After hours, and the day restated as it ends, leave the session's figures.
  push(
    Push.Quote,
    quotePush({ last: "90", volume: 9, timestamp: at("16:30:00"), session: 2 })
  );
  push(
    Push.Quote,
    quotePush({ last: "80", volume: 8, timestamp: at("16:31:00"), tag: 1 })
  );

  expect(books).toHaveLength(2);
  expect(books[0]).toMatchObject({
    bids: [{ price: 100.7, shares: 200 }],
    asks: [{ price: 100.9, shares: 300 }],
    last: 100.5,
  });
  expect(books[1]).toMatchObject({
    date: "2026-10-28",
    reference: 98,
    last: 100.8,
    high: 102,
    average: 101,
    volume: 2_000,
    bids: [{ price: 100.7, shares: 200 }],
  });
  expect(books[1].time).toBeGreaterThanOrEqual(books[0].time);
});

test("a push carries only what changed, so the session's other figures and the book's other levels stand", async () => {
  const { stream, push } = setup();
  const books: Depth[] = [];

  stream.watchDepth(APPLE, (depth) => books.push(depth));
  await settled();

  push(
    Push.Depth,
    depthPush({
      bids: [
        { position: 1, price: "100.4", volume: 100 },
        { position: 2, price: "100.3", volume: 50 },
      ],
      asks: [{ position: 1, price: "100.6", volume: 100 }],
    })
  );
  push(
    Push.Depth,
    depthPush({ bids: [{ position: 2, price: "100.2", volume: 70 }] })
  );
  push(Push.Quote, quotePush({ volume: 1_010, timestamp: at("10:35:02") }));

  expect(books.at(-2)).toMatchObject({
    bids: [
      { price: 100.4, shares: 100 },
      { price: 100.2, shares: 70 },
    ],
    asks: [{ price: 100.6, shares: 100 }],
  });
  expect(books.at(-1)).toMatchObject({
    open: 100,
    high: 101,
    low: 99,
    last: 100.5,
    average: 100.2,
    volume: 1_010,
  });
});

test("a new session's quote counts its move from the last price before it, and keeps none of its figures", async () => {
  const { stream, push } = setup({
    depth: { ...DEPTH, date: "2026-10-27", last: 97.5 },
  });

  const books: Depth[] = [];

  stream.watchDepth(APPLE, (depth) => books.push(depth));
  await settled();
  push(
    Push.Quote,
    quotePush({
      last: "99",
      open: "99",
      volume: 10,
      turnover: "990",
      timestamp: at("09:30:01"),
    })
  );

  expect(books[0]).toMatchObject({
    date: "2026-10-28",
    reference: 97.5,
    open: 99,
    high: null,
    low: null,
    last: 99,
    average: 99,
    volume: 10,
  });
});

test("a dropped connection is subscribed again, each watch started afresh", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  const { stream, drop, asked, subscriptions } = setup();
  const listener = minuteListener();

  stream.watchMinutes(APPLE, listener);
  stream.watchDepth(APPLE, () => undefined);
  await vi.advanceTimersByTimeAsync(0);

  drop();
  await vi.advanceTimersByTimeAsync(1_000);

  expect(asked).toHaveLength(2);
  expect(listener.onSession).toHaveBeenCalledTimes(2);
  expect(
    subscriptions(Request.Subscribe)
      .map(({ types }) => types.join())
      .sort()
  ).toEqual(["1,2", "1,2", "4", "4"]);
});

test("a request that fails is tried again later, and a listing Longbridge does not list never again", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  const { stream, refuse, subscriptions } = setup();

  const failing = new LongbridgeError(
    "Longbridge's quote server stopped answering"
  );

  let answer: Error | undefined = failing;

  refuse(({ command }) => (command === Request.Subscribe ? answer : undefined));
  stream.watchMinutes(APPLE, minuteListener());
  await vi.advanceTimersByTimeAsync(0);

  answer = new LongbridgeError(
    "Longbridge refused the request: invalid symbol",
    301_600
  );
  await vi.advanceTimersByTimeAsync(1_000);
  await vi.advanceTimersByTimeAsync(60_000);

  expect(subscriptions(Request.Subscribe)).toHaveLength(2);
});

test("the last listener leaving unsubscribes, and closing unsubscribes the rest", async () => {
  const { stream, subscriptions } = setup();

  const stopMinutes = stream.watchMinutes(APPLE, minuteListener());
  const stopOther = stream.watchMinutes(APPLE, minuteListener());

  stream.watchDepth(APPLE, () => undefined);
  await settled();

  stopMinutes?.();

  expect(subscriptions(Request.Unsubscribe)).toEqual([]);

  stopOther?.();
  stream.close();

  expect(subscriptions(Request.Unsubscribe)).toEqual([
    { symbols: ["AAPL.US"], types: [4], first: false },
    { symbols: ["AAPL.US"], types: [1, 2], first: false },
  ]);
});

test("a watch stopped while it loads takes its subscription off again", async () => {
  const { stream, subscriptions } = setup();

  const stop = stream.watchDepth(APPLE, () => undefined);

  stop?.();
  await settled();

  expect(subscriptions(Request.Subscribe)).toEqual([]);
});

test("takes US listings alone, up to the subscriptions a sign-in holds", () => {
  const { stream } = setup();
  const tsmc: SymbolRef = { market: Market.TW, symbol: "2330" };

  expect(stream.watchMinutes(tsmc, minuteListener())).toBeUndefined();

  for (let index = 0; index < 500; index += 1) {
    expect(
      stream.watchDepth(
        { market: Market.US, symbol: `S${index}` },
        () => undefined
      )
    ).toBeDefined();
  }

  expect(
    stream.watchDepth({ market: Market.US, symbol: "S500" }, () => undefined)
  ).toBeUndefined();
  expect(
    stream.watchDepth({ market: Market.US, symbol: "S0" }, () => undefined)
  ).toBeDefined();

  stream.close();
});
