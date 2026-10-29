import { BinaryReader, BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { noop } from "es-toolkit";
import { describe, expect, test } from "vite-plus/test";

import { Interval } from "@solyx/core/candles";
import { Market } from "@solyx/core/market";
import { LongbridgeError, createLongbridge } from "@solyx/longbridge/client";
import { decodeError } from "@solyx/longbridge/wire";
import type { Command } from "@solyx/longbridge/wire";

import {
  createLongbridgeMarketData,
  readLongbridgeSecurities,
} from "../src/longbridge.ts";

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

/** A Longbridge whose quote server answers each request as `answer` says; one it leaves unanswered never settles. */
function setup(
  answer: Handler,
  { now = new Date("2026-10-28T14:00:00Z") }: { now?: Date } = {}
) {
  const asked: SentRequest[] = [];

  const request = async (command: Command, body: Uint8Array) => {
    const sent = { command, id: asked.length + 1, body };

    asked.push(sent);

    const answered = answer(sent);

    if (!answered) return new Promise<Uint8Array>(noop);

    if (answered.status !== 0) {
      const { code, message } = decodeError(answered.body);

      throw new LongbridgeError(
        `Longbridge refused the request: ${message}`,
        code
      );
    }

    return answered.body;
  };

  return {
    asked,
    longbridge: createLongbridgeMarketData({ request }, { now: () => now }),
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
  symbol = "AAPL.US",
  last,
  previous,
  timestamp,
}: {
  symbol?: string;
  last: string;
  previous: string;
  timestamp: number;
}) {
  return new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .fork()
    .tag(1, WireType.LengthDelimited)
    .string(symbol)
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

test("names a listing in traditional Chinese, with its English name beside, and keeps a dotted ticker's dot", async () => {
  const { longbridge, asked } = setup(() =>
    ok(staticInfo("BRK.B.US", "Berkshire Hathaway B", "伯克希爾哈撒韋-B"))
  );

  expect(await longbridge.getListing(BERKSHIRE)).toEqual({
    name: "伯克希爾哈撒韋-B",
    englishName: "Berkshire Hathaway B",
  });
  expect(requestFields(asked[0].body).get(1)).toEqual(["BRK.B.US"]);
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
  const { longbridge, asked } = setup(() =>
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

  // The forward-adjusted bars match these, so nothing split or paid out: each counts from the close before.
  expect(bars).toEqual([
    {
      time: Date.parse("2026-10-26T04:00:00Z") / 1000,
      open: 343.92,
      high: 347.09,
      low: 341.03,
      close: 343.91,
      volume: 42_743_575,
      reference: 347.725,
    },
    {
      time: Date.parse("2026-10-27T04:00:00Z") / 1000,
      open: 343.165,
      high: 347.78,
      low: 342.39,
      close: 347.1,
      volume: 39_984_395,
      reference: 343.91,
    },
  ]);

  const [traded, adjusted] = asked;

  expect(traded.command).toBe(19);
  // Daily bars, the latest thousand, as traded, regular session only; then forward-adjusted.
  expect(Object.fromEntries(requestFields(traded.body))).toEqual({
    1: ["AAPL.US"],
    2: [1000],
    3: [1000],
    4: [0],
    5: [0],
  });
  expect(requestFields(adjusted.body).get(4)).toEqual([1]);
});

test("a daily bar counts from the close before, carried over a split or a payout as the forward-adjusted bars step", async () => {
  const day = (date: string, close: string) => ({
    time: `${date}T04:00:00Z`,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1_000,
  });

  // A ten-for-one split on the 21st and 0.50 paid out on the 23rd, which the adjusted bars carry back.
  const traded = [
    day("2026-10-20", "1000.000"),
    day("2026-10-21", "102.000"),
    day("2026-10-22", "104.000"),
    day("2026-10-23", "101.000"),
    day("2026-10-26", "103.000"),
  ];

  const adjusted = [
    day("2026-10-20", "99.519"),
    day("2026-10-21", "101.510"),
    day("2026-10-22", "103.500"),
    day("2026-10-23", "101.000"),
    day("2026-10-26", "103.000"),
  ];

  const { longbridge } = setup((request) =>
    ok(
      candlesticks(
        requestFields(request.body).get(4)?.[0] === 1 ? adjusted : traded
      )
    )
  );

  const bars = await longbridge.getCandles({
    symbol: APPLE,
    interval: Interval.OneDay,
    from: "2026-10-20",
    to: "2026-10-26",
  });

  const references = bars.map(({ reference }) => reference);

  expect(references[0]).toBeUndefined();
  expect(references[1]).toBeCloseTo(100, 2);
  // The adjusted closes' rounding alone moved the 22nd's step, so it counts from the close before.
  expect(references[2]).toBe(102);
  expect(references[3]).toBeCloseTo(103.5, 6);
  expect(references[4]).toBe(101);
});

test("bars shorter than a day carry no reference, asked for as traded alone", async () => {
  const { longbridge, asked } = setup(() => ok(candlesticks([])));

  await longbridge.getCandles({
    symbol: APPLE,
    interval: Interval.FiveMinutes,
    from: "2026-10-28",
    to: "2026-10-28",
  });

  expect(asked.map(({ body }) => requestFields(body).get(4))).toEqual([[0]]);
});

test("asks for minute bars by their period", async () => {
  const { longbridge, asked } = setup(() => ok(candlesticks([])));

  await longbridge.getCandles({
    symbol: APPLE,
    interval: Interval.FifteenMinutes,
    from: "2026-10-28",
    to: "2026-10-28",
  });

  expect(requestFields(asked[0].body).get(2)).toEqual([15]);
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

  const { longbridge, asked } = setup(({ body }) => {
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

  const asks = asked.map(({ body }) => {
    const fields = requestFields(body);

    return [fields.get(2)?.[0], fields.get(3)?.[0]];
  });

  expect(asks).toEqual([
    ["20261015", "20261031"],
    ["20261101", "20261130"],
    ["20261201", "20261231"],
    ["20270101", "20270131"],
  ]);
});

test("has no trading days for another market", async () => {
  const { longbridge, asked } = setup(() => undefined);

  expect(await longbridge.tradingDays(Market.TW, "2026-10-01")).toEqual({
    trading: [],
    earlyCloses: [],
  });
  expect(asked).toHaveLength(0);
});

test("refuses a listing in another market", async () => {
  const { longbridge } = setup(() => undefined);

  await expect(
    longbridge.getQuote({ market: Market.TW, symbol: "2330" })
  ).rejects.toThrow("longbridge has no data for TW listings");
});

/** One answer of several quotes, as protobuf merges messages' repeated fields. */
function quotes(...each: Uint8Array[]) {
  const body = new Uint8Array(each.reduce((size, one) => size + one.length, 0));

  each.reduce((at, one) => {
    body.set(one, at);

    return at + one.length;
  }, 0);

  return body;
}

const NVIDIA = { market: Market.US, symbol: "NVDA" };

const UNLISTED = { market: Market.US, symbol: "ZZZZ" };

const lastOf = (symbol: string, last: string) =>
  quote({
    symbol,
    last,
    previous: "100.000",
    timestamp: Date.parse("2026-10-27T20:00:00Z") / 1000,
  });

describe("quotes asked for together", () => {
  test("go out as one request, each answered with its own", async () => {
    const { longbridge, asked } = setup(() =>
      ok(quotes(lastOf("AAPL.US", "347.100"), lastOf("NVDA.US", "190.500")))
    );

    const [apple, nvidia] = await Promise.all([
      longbridge.getQuote(APPLE),
      longbridge.getQuote(NVIDIA),
    ]);

    expect(apple?.last).toBe(347.1);
    expect(nvidia?.last).toBe(190.5);

    expect(asked.map(({ command }) => command)).toEqual([11]);
    expect(requestFields(asked[0].body).get(1)).toEqual(["AAPL.US", "NVDA.US"]);
  });

  test("are asked one by one where Longbridge does not list one of them, which fails them all", async () => {
    const { longbridge, asked } = setup(({ body }) => {
      const symbols = requestFields(body).get(1) ?? [];

      return symbols.includes("ZZZZ.US")
        ? notListed()
        : ok(lastOf(String(symbols[0]), "347.100"));
    });

    const [apple, unlisted] = await Promise.all([
      longbridge.getQuote(APPLE),
      longbridge.getQuote(UNLISTED),
    ]);

    expect(apple?.last).toBe(347.1);
    expect(unlisted).toBeNull();
    expect(asked.map(({ body }) => requestFields(body).get(1))).toEqual([
      ["AAPL.US", "ZZZZ.US"],
      ["AAPL.US"],
      ["ZZZZ.US"],
    ]);
  });
});

/** The sign-in's HTTP API over `fetch`, as the backend hands the list's reader one. */
const listApi = (fetch: typeof globalThis.fetch) =>
  createLongbridge({ accessToken: async () => TOKEN, fetch });

describe("the list of US listings", () => {
  test("names each in traditional Chinese with its English name beside, its ticker without the market", async () => {
    const sent: Request[] = [];

    const listed = await readLongbridgeSecurities(
      listApi(async (input, init) => {
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
      })
    );

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
      readLongbridgeSecurities(
        listApi(async () =>
          Response.json(
            { code: 401_003, message: "token expired", data: null },
            { status: 401 }
          )
        )
      )
    ).rejects.toThrow(
      "Longbridge refused its list of US listings: token expired"
    );
  });
});
