import { gzipSync } from "node:zlib";

import { BinaryReader, BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { Interval } from "@solyx/core/candles";
import { Market } from "@solyx/core/market";

import {
  LongbridgeError,
  createLongbridgeMarketData,
  createLongbridgeSocket,
  readLongbridgeSecurities,
} from "../src/longbridge.ts";
import type { LongbridgeWebSocket } from "../src/longbridge.ts";

const APPLE = { market: Market.US, symbol: "AAPL" };

const BERKSHIRE = { market: Market.US, symbol: "BRK.B" };

const TOKEN = "hk_eyJ.test.token";

interface SentRequest {
  command: number;
  id: number;
  body: Uint8Array;
}

interface Answer {
  status: number;
  body: Uint8Array;
}

/** What a test's server answers a request with; `undefined` leaves it unanswered. */
type Handler = (request: SentRequest) => Answer | undefined;

const ok = (body: Uint8Array): Answer => ({ status: 0, body });

function refused(status: number, code: number, message: string): Answer {
  return {
    status,
    body: new BinaryWriter()
      .tag(1, WireType.Varint)
      .uint64(code)
      .tag(2, WireType.LengthDelimited)
      .string(message)
      .finish(),
  };
}

function response(
  { command, id }: SentRequest,
  { status, body }: Answer,
  gzip = false
) {
  const payload = gzip ? new Uint8Array(gzipSync(body)) : body;
  const packet = new Uint8Array(10 + payload.length);
  const view = new DataView(packet.buffer);

  packet[0] = gzip ? 0x22 : 0x02;
  packet[1] = command;
  view.setUint32(2, id);
  packet[6] = status;
  packet[7] = (payload.length >> 16) & 0xff;
  packet[8] = (payload.length >> 8) & 0xff;
  packet[9] = payload.length & 0xff;
  packet.set(payload, 10);

  return packet.buffer;
}

function readRequest(packet: Uint8Array): SentRequest {
  const view = new DataView(packet.buffer, packet.byteOffset);
  const length = (packet[8] << 16) | (packet[9] << 8) | packet[10];

  return {
    command: packet[1],
    id: view.getUint32(2),
    body: packet.slice(11, 11 + length),
  };
}

/** A request body's text and number fields, by field number. */
function requestFields(body: Uint8Array) {
  const reader = new BinaryReader(body);
  const fields = new Map<number, (string | number)[]>();

  while (reader.pos < reader.len) {
    const [field, wireType] = reader.tag();

    const value =
      wireType === WireType.Varint ? reader.int32() : reader.string();

    fields.set(field, [...(fields.get(field) ?? []), value]);
  }

  return fields;
}

/** Plays Longbridge's quote server over fake sockets. */
class FakeSocket implements LongbridgeWebSocket {
  readonly requests: SentRequest[] = [];
  closed = false;
  private readonly handlers = new Map<
    string,
    ((event: { data?: unknown }) => void)[]
  >();

  readonly headers: Record<string, string>;
  private readonly answer: Handler;

  constructor(headers: Record<string, string>, answer: Handler) {
    this.headers = headers;
    this.answer = answer;
    queueMicrotask(() => this.emit("open"));
  }

  addEventListener(
    type: "open" | "close" | "error" | "message",
    listener: (event: { data?: unknown }) => void
  ) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), listener]);
  }

  send(data: Uint8Array) {
    const request = readRequest(data);

    this.requests.push(request);

    const answer =
      request.command === 2 ? ok(new Uint8Array()) : this.answer(request);

    if (answer) {
      queueMicrotask(() =>
        this.emit("message", response(request, answer, request.command === 10))
      );
    }
  }

  close() {
    if (this.closed) return;

    this.closed = true;
    this.emit("close");
  }

  emit(type: "open" | "close" | "error" | "message", data?: ArrayBuffer) {
    for (const handler of this.handlers.get(type) ?? []) handler({ data });
  }
}

function setup(
  answer: Handler,
  {
    envelope = { code: 0, message: "success", data: { otp: "otp-1" } },
    now = new Date("2026-10-28T14:00:00Z"),
  }: { envelope?: unknown; now?: Date } = {}
) {
  const sockets: FakeSocket[] = [];
  const passwords: { url: string; headers: Headers }[] = [];

  const socket = createLongbridgeSocket({
    accessToken: async () => TOKEN,
    fetch: async (input, init) => {
      const request = new Request(input, init);

      passwords.push({ url: request.url, headers: request.headers });

      return Response.json(envelope);
    },
    connect: (_url, headers) => {
      const fake = new FakeSocket(headers, answer);

      sockets.push(fake);

      return fake;
    },
  });

  return {
    sockets,
    passwords,
    socket,
    longbridge: createLongbridgeMarketData(socket, { now: () => now }),
  };
}

function staticInfo(symbol: string, nameEn: string, nameHk: string) {
  return new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .fork()
    .tag(1, WireType.LengthDelimited)
    .string(symbol)
    .tag(3, WireType.LengthDelimited)
    .string(nameEn)
    .tag(4, WireType.LengthDelimited)
    .string(nameHk)
    .join()
    .finish();
}

function quote({
  last,
  previous,
  timestamp,
}: {
  last: string;
  previous: string;
  timestamp: number;
}) {
  return new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .fork()
    .tag(1, WireType.LengthDelimited)
    .string("AAPL.US")
    .tag(2, WireType.LengthDelimited)
    .string(last)
    .tag(3, WireType.LengthDelimited)
    .string(previous)
    .tag(4, WireType.LengthDelimited)
    .string("343.165")
    .tag(5, WireType.LengthDelimited)
    .string("347.780")
    .tag(6, WireType.LengthDelimited)
    .string("342.390")
    .tag(7, WireType.Varint)
    .int64(timestamp)
    .tag(8, WireType.Varint)
    .int64(40_000)
    .tag(9, WireType.LengthDelimited)
    .string("13880000.000")
    .join()
    .finish();
}

function level(
  writer: BinaryWriter,
  field: number,
  position: number,
  price: string,
  volume: number
) {
  return writer
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

function candlesticks(
  bars: {
    time: string;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: number;
  }[]
) {
  const writer = new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string("AAPL.US");

  for (const bar of bars) {
    writer
      .tag(2, WireType.LengthDelimited)
      .fork()
      .tag(1, WireType.LengthDelimited)
      .string(bar.close)
      .tag(2, WireType.LengthDelimited)
      .string(bar.open)
      .tag(3, WireType.LengthDelimited)
      .string(bar.low)
      .tag(4, WireType.LengthDelimited)
      .string(bar.high)
      .tag(5, WireType.Varint)
      .int64(bar.volume)
      .tag(7, WireType.Varint)
      .int64(Date.parse(bar.time) / 1000)
      .join();
  }

  return writer.finish();
}

function tradeDays(trading: string[], halfDays: string[] = []) {
  const writer = new BinaryWriter();

  for (const day of trading)
    writer.tag(1, WireType.LengthDelimited).string(day);

  for (const day of halfDays)
    writer.tag(2, WireType.LengthDelimited).string(day);

  return writer.finish();
}

const notListed = () => refused(7, 301_600, "invalid symbol");

test("signs in with a one-time password before its first request, and keeps the connection", async () => {
  const { longbridge, sockets, passwords } = setup(() =>
    ok(staticInfo("AAPL.US", "Apple", "蘋果"))
  );

  await longbridge.getListing(APPLE);
  await longbridge.getListing(APPLE);

  expect(passwords).toHaveLength(1);
  expect(passwords[0].url).toBe(
    "https://openapi.longbridge.com/v1/socket/token"
  );
  expect(passwords[0].headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
  expect(passwords[0].headers.get("x-dc-region")).toBe("ap");

  expect(sockets).toHaveLength(1);
  expect(sockets[0].headers).toEqual({ "x-dc-region": "ap" });

  const [auth, ...asked] = sockets[0].requests;

  expect(auth.command).toBe(2);
  expect(requestFields(auth.body).get(1)).toEqual(["otp-1"]);
  expect(asked.map(({ command }) => command)).toEqual([10, 10]);
  expect(requestFields(asked[0].body).get(1)).toEqual(["AAPL.US"]);
});

test("names a listing in traditional Chinese, with its English name beside, and keeps a dotted ticker's dot", async () => {
  const { longbridge, sockets } = setup(() =>
    ok(staticInfo("BRK.B.US", "Berkshire Hathaway B", "伯克希爾哈撒韋-B"))
  );

  expect(await longbridge.getListing(BERKSHIRE)).toEqual({
    name: "伯克希爾哈撒韋-B",
    englishName: "Berkshire Hathaway B",
  });
  expect(requestFields(sockets[0].requests[1].body).get(1)).toEqual([
    "BRK.B.US",
  ]);
});

test("a symbol Longbridge does not list has no listing, quote, depth or bars", async () => {
  const { longbridge } = setup(notListed);

  expect(await longbridge.getListing(APPLE)).toBeNull();
  expect(await longbridge.getQuote(APPLE)).toBeNull();
  expect(await longbridge.getDepth(APPLE)).toBeNull();
  expect(
    await longbridge.getCandles({
      symbol: APPLE,
      interval: Interval.OneDay,
      from: "2026-10-01",
      to: "2026-10-28",
    })
  ).toEqual([]);
});

test("serves the latest bars within the range asked for, oldest first, as traded in the regular session", async () => {
  const { longbridge, sockets } = setup(() =>
    ok(
      candlesticks([
        // Daily bars open at midnight in New York.
        {
          time: "2026-10-27T04:00:00Z",
          open: "343.165",
          high: "347.780",
          low: "342.390",
          close: "347.100",
          volume: 39_984_395,
        },
        {
          time: "2026-10-23T04:00:00Z",
          open: "349.115",
          high: "351.730",
          low: "345.750",
          close: "347.725",
          volume: 39_539_690,
        },
        {
          time: "2026-10-26T04:00:00Z",
          open: "343.920",
          high: "347.090",
          low: "341.030",
          close: "343.910",
          volume: 42_743_575,
        },
      ])
    )
  );

  const bars = await longbridge.getCandles({
    symbol: APPLE,
    interval: Interval.OneDay,
    from: "2026-10-26",
    to: "2026-10-28",
  });

  expect(bars).toEqual([
    {
      time: Date.parse("2026-10-26T04:00:00Z") / 1000,
      open: 343.92,
      high: 347.09,
      low: 341.03,
      close: 343.91,
      volume: 42_743_575,
    },
    {
      time: Date.parse("2026-10-27T04:00:00Z") / 1000,
      open: 343.165,
      high: 347.78,
      low: 342.39,
      close: 347.1,
      volume: 39_984_395,
    },
  ]);

  const asked = requestFields(sockets[0].requests[1].body);

  expect(sockets[0].requests[1].command).toBe(19);
  // Daily bars, the latest thousand, as traded, regular session only.
  expect(Object.fromEntries(asked)).toEqual({
    1: ["AAPL.US"],
    2: [1000],
    3: [1000],
    4: [0],
    5: [0],
  });
});

test("asks for minute bars by their period", async () => {
  const { longbridge, sockets } = setup(() => ok(candlesticks([])));

  await longbridge.getCandles({
    symbol: APPLE,
    interval: Interval.FifteenMinutes,
    from: "2026-10-28",
    to: "2026-10-28",
  });

  expect(requestFields(sockets[0].requests[1].body).get(2)).toEqual([15]);
});

test("a quote measures the session from the close before it, on New York's date", async () => {
  const { longbridge } = setup(() =>
    ok(
      quote({
        last: "347.100",
        previous: "343.910",
        // 16:00 in New York on 2026-10-27, 04:00 the next day in Taipei.
        timestamp: Date.parse("2026-10-27T20:00:00Z") / 1000,
      })
    )
  );

  expect(await longbridge.getQuote(APPLE)).toEqual({
    date: "2026-10-27",
    last: 347.1,
    reference: 343.91,
    tradeValue: 13_880_000,
  });
});

test("a listing that has not traded has no quote", async () => {
  const { longbridge } = setup(() =>
    ok(quote({ last: "", previous: "", timestamp: 0 }))
  );

  expect(await longbridge.getQuote(APPLE)).toBeNull();
});

test("depth pairs the best bid and ask with the session so far", async () => {
  const { longbridge } = setup(({ command }) => {
    if (command === 11) {
      return ok(
        quote({
          last: "345.920",
          previous: "347.100",
          timestamp: Date.parse("2026-10-28T13:45:00Z") / 1000,
        })
      );
    }

    const book = new BinaryWriter()
      .tag(1, WireType.LengthDelimited)
      .string("AAPL.US");

    level(book, 2, 1, "346.010", 564);
    level(book, 3, 1, "345.620", 600);

    return ok(book.finish());
  });

  expect(await longbridge.getDepth(APPLE)).toEqual({
    date: "2026-10-28",
    time: Date.parse("2026-10-28T13:45:00Z"),
    reference: 347.1,
    open: 343.165,
    high: 347.78,
    low: 342.39,
    last: 345.92,
    average: 347,
    volume: 40_000,
    volumeAtBid: 0,
    volumeAtAsk: 0,
    bids: [{ price: 345.62, shares: 600 }],
    asks: [{ price: 346.01, shares: 564 }],
    trial: false,
  });
});

test("reads the days the US trades a month at a time, early closes among them, until a month not yet set", async () => {
  const months = new Map([
    ["20261015", tradeDays(["20261015", "20261016"])],
    ["20261101", tradeDays(["20261125", "20261130"], ["20261127"])],
    ["20261201", tradeDays(["20261223"], ["20261224"])],
    ["20270101", tradeDays([])],
  ]);

  const { longbridge, sockets } = setup(({ body }) => {
    const fields = requestFields(body);

    expect(fields.get(1)).toEqual(["US"]);

    return ok(months.get(String(fields.get(2)?.[0])) ?? tradeDays([]));
  });

  expect(await longbridge.tradingDays(Market.US, "2026-10-15")).toEqual({
    trading: [
      "2026-10-15",
      "2026-10-16",
      "2026-11-25",
      "2026-11-27",
      "2026-11-30",
      "2026-12-23",
      "2026-12-24",
    ],
    earlyCloses: ["2026-11-27", "2026-12-24"],
  });

  const asked = sockets[0].requests.slice(1).map(({ body }) => {
    const fields = requestFields(body);

    return [fields.get(2)?.[0], fields.get(3)?.[0]];
  });

  expect(asked).toEqual([
    ["20261015", "20261031"],
    ["20261101", "20261130"],
    ["20261201", "20261231"],
    ["20270101", "20270131"],
  ]);
});

test("has no trading days for another market", async () => {
  const { longbridge, passwords } = setup(() => undefined);

  expect(await longbridge.tradingDays(Market.TW, "2026-10-01")).toEqual({
    trading: [],
    earlyCloses: [],
  });
  expect(passwords).toHaveLength(0);
});

test("refuses a listing in another market", async () => {
  const { longbridge } = setup(() => undefined);

  await expect(
    longbridge.getQuote({ market: Market.TW, symbol: "2330" })
  ).rejects.toThrow("longbridge has no data for TW listings");
});

test("a refused request names Longbridge and the reason it gives", async () => {
  const { longbridge } = setup(() => refused(3, 301_606, "rate limited"));

  const failure = longbridge.getQuote(APPLE);

  await expect(failure).rejects.toThrow(
    "Longbridge refused the request: rate limited"
  );
  await expect(failure).rejects.toMatchObject({ code: 301_606 });
});

test("a sign-in Longbridge refuses names its reason", async () => {
  const { longbridge, sockets } = setup(() => undefined, {
    envelope: { code: 401_003, message: "token expired", data: null },
  });

  const failure = longbridge.getQuote(APPLE);

  await expect(failure).rejects.toThrow(
    "Longbridge refused the sign-in: token expired"
  );
  await expect(failure).rejects.toMatchObject({ code: 401_003 });
  await expect(failure).rejects.toBeInstanceOf(LongbridgeError);
  expect(sockets).toHaveLength(0);
});

test("a connection that closes fails what it was asked, and the next request opens another", async () => {
  let answering = false;

  const { longbridge, sockets, passwords } = setup(() =>
    answering ? ok(staticInfo("AAPL.US", "Apple", "蘋果")) : undefined
  );

  const lost = longbridge.getListing(APPLE);

  await expect.poll(() => sockets[0]?.requests.length).toBe(2);
  sockets[0].close();

  await expect(lost).rejects.toThrow("Longbridge closed the quote connection");

  answering = true;

  expect(await longbridge.getListing(APPLE)).toMatchObject({ name: "蘋果" });
  expect(sockets).toHaveLength(2);
  expect(passwords).toHaveLength(2);
});

describe("the server closing the connection", () => {
  test("fails what was asked with the reason it gives", async () => {
    const { longbridge, sockets } = setup(() => undefined);

    const lost = longbridge.getListing(APPLE);

    await expect.poll(() => sockets[0]?.requests.length).toBe(2);

    const reason = new BinaryWriter()
      .tag(1, WireType.Varint)
      .int32(5)
      .tag(2, WireType.LengthDelimited)
      .string("session expired")
      .finish();

    const push = new Uint8Array(5 + reason.length);

    push[0] = 0x03;
    push[1] = 0;
    push[4] = reason.length;
    push.set(reason, 5);
    sockets[0].emit("message", push.buffer);

    await expect(lost).rejects.toThrow(
      "Longbridge closed the quote connection: session expired"
    );
    expect(sockets[0].closed).toBe(true);
  });
});

/** A push packet: type, command and length, then the body. */
function pushPacket(command: number, body: Uint8Array) {
  const packet = new Uint8Array(5 + body.length);

  packet[0] = 0x03;
  packet[1] = command;
  packet[2] = (body.length >> 16) & 0xff;
  packet[3] = (body.length >> 8) & 0xff;
  packet[4] = body.length & 0xff;
  packet.set(body, 5);

  return packet.buffer;
}

describe("pushes and drops", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("every push reaches the listeners, and a signed-in connection dropping tells them", async () => {
    const { socket, longbridge, sockets } = setup(() =>
      ok(staticInfo("AAPL.US", "Apple", "蘋果"))
    );

    const pushes: [number, number[]][] = [];
    const drops = vi.fn();

    socket.onPush((command, body) => pushes.push([command, [...body]]));
    socket.onDrop(drops);
    await longbridge.getListing(APPLE);

    sockets[0].emit("message", pushPacket(104, new Uint8Array([8, 1])));

    expect(pushes).toEqual([[104, [8, 1]]]);
    expect(drops).not.toHaveBeenCalled();

    sockets[0].close();

    expect(drops).toHaveBeenCalledTimes(1);
  });

  test("a connection that never signed in drops without telling them, as it held no subscriptions", async () => {
    const { socket, longbridge } = setup(() => undefined, {
      envelope: { code: 401, message: "token expired", data: null },
    });

    const drops = vi.fn();

    socket.onDrop(drops);

    await expect(longbridge.getListing(APPLE)).rejects.toThrow("token expired");
    expect(drops).not.toHaveBeenCalled();
  });

  test("a heartbeat goes every half a minute, and one left unanswered drops the connection", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });

    let answering = true;

    const { socket, longbridge, sockets } = setup((request) =>
      request.command !== 1 || answering
        ? ok(staticInfo("AAPL.US", "Apple", "蘋果"))
        : undefined
    );

    const drops = vi.fn();

    socket.onDrop(drops);
    await longbridge.getListing(APPLE);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(sockets[0].requests.map(({ command }) => command)).toEqual([
      2, 10, 1,
    ]);
    expect(drops).not.toHaveBeenCalled();

    answering = false;
    await vi.advanceTimersByTimeAsync(30_000 + 15_000);

    expect(drops).toHaveBeenCalledTimes(1);
    expect(sockets[0].closed).toBe(true);
  });
});

test("nothing is asked once the connection is closed for good", async () => {
  const { socket, longbridge } = setup(() => undefined);

  socket.close();

  await expect(longbridge.getListing(APPLE)).rejects.toThrow(
    "The Longbridge connection closed"
  );
});

describe("the list of US listings", () => {
  test("names each in traditional Chinese with its English name beside, its ticker without the market", async () => {
    const sent: Request[] = [];

    const listed = await readLongbridgeSecurities(TOKEN, {
      fetch: async (input, init) => {
        sent.push(new Request(input, init));

        return Response.json({
          code: 0,
          message: "success",
          data: {
            list: [
              {
                symbol: "AAPL.US",
                name_cn: "苹果",
                name_hk: "蘋果",
                name_en: "Apple Inc.",
              },
              {
                symbol: "BRK.B.US",
                name_hk: "伯克希爾哈撒韋-B",
                name_en: "Berkshire Hathaway Inc.",
              },
              {
                symbol: "RKLB.US",
                name_hk: "",
                name_en: "Rocket Lab Corporation",
              },
              { symbol: "700.HK", name_hk: "騰訊控股", name_en: "Tencent" },
              { symbol: "ZZZZ.US", name_hk: "", name_en: "" },
            ],
          },
        });
      },
    });

    expect(listed).toEqual([
      { symbol: "AAPL", name: "蘋果", englishName: "Apple Inc." },
      {
        symbol: "BRK.B",
        name: "伯克希爾哈撒韋-B",
        englishName: "Berkshire Hathaway Inc.",
      },
      {
        symbol: "RKLB",
        name: "Rocket Lab Corporation",
        englishName: "Rocket Lab Corporation",
      },
    ]);

    const url = new URL(sent[0].url);

    expect(url.origin + url.pathname).toBe(
      "https://openapi.longbridge.com/v1/quote/get_security_list"
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      market: "US",
      category: "Overnight",
    });
    expect(sent[0].headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(sent[0].headers.get("x-dc-region")).toBe("ap");
  });

  test("a refused read names Longbridge and its reason", async () => {
    await expect(
      readLongbridgeSecurities(TOKEN, {
        fetch: async () =>
          Response.json(
            { code: 401_003, message: "token expired", data: null },
            { status: 401 }
          ),
      })
    ).rejects.toThrow(
      "Longbridge refused its list of US listings: token expired"
    );
  });
});
