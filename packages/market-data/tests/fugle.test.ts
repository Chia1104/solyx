import { expect, test } from "vite-plus/test";

import { Interval } from "@solyx/core/candles";
import { Market } from "@solyx/core/market";

import { createFugleMarketData } from "../src/fugle.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

// 2026-09-29 10:00 in Taipei, during the regular session.
const DURING_SESSION = new Date("2026-09-29T02:00:00Z");

interface Route {
  path: string;
  /** @default 200 */
  status?: number;
  /** JSON text, so malformed payloads can be expressed too. */
  body: string;
}

/** Answers Fugle paths with canned bodies and records every request. */
function fakeFugle(routes: Route[]) {
  const requests: URL[] = [];

  const fetch = async (input: string | URL | Request) => {
    const request = new Request(input);
    const url = new URL(request.url);

    requests.push(url);
    expect(request.headers.get("X-API-KEY")).toBe("test-key");

    const route = routes.find((candidate) =>
      url.pathname.endsWith(candidate.path)
    );

    return new Response(route?.body ?? JSON.stringify({ data: [] }), {
      status: route?.status,
      headers: { "Content-Type": "application/json" },
    });
  };

  return { fetch, requests };
}

/** Requests run in parallel, so they are found by endpoint rather than by order. */
function requestTo(requests: URL[], endpoint: string): URL | undefined {
  return requests.find((url) => url.pathname.includes(`/${endpoint}/`));
}

function bar(date: string, close: number, volume: number) {
  return { date, open: close, high: close + 1, low: close - 1, close, volume };
}

test("daily bars open at Taipei midnight and keep share volume", async () => {
  const { fetch } = fakeFugle([
    {
      path: "/historical/candles/2330",
      body: JSON.stringify({ data: [bar("2026-09-23", 2500, 22_817_873)] }),
    },
  ]);

  const provider = createFugleMarketData({
    apiKey: "test-key",
    fetch,
    now: () => DURING_SESSION,
  });

  const candles = await provider.getCandles({
    symbol: TSMC,
    interval: Interval.OneDay,
    from: "2026-09-01",
    to: "2026-09-24",
  });

  expect(candles).toEqual([
    {
      time: Date.parse("2026-09-22T16:00:00Z") / 1000,
      open: 2500,
      high: 2501,
      low: 2499,
      close: 2500,
      volume: 22_817_873,
    },
  ]);
});

test("minute bars convert board lots to shares and append today's session", async () => {
  const { fetch, requests } = fakeFugle([
    {
      path: "/historical/candles/2330",
      body: JSON.stringify({
        data: [
          bar("2026-09-24T13:25:00.000+08:00", 2480, 400),
          bar("2026-09-24T13:30:00.000+08:00", 2475, 2165),
        ],
      }),
    },
    {
      path: "/intraday/candles/2330",
      body: JSON.stringify({
        date: "2026-09-29",
        data: [
          bar("2026-09-29T09:00:00.000+08:00", 2475, 5651),
          bar("2026-09-29T09:05:00.000+08:00", 2485, 505),
        ],
      }),
    },
  ]);

  const provider = createFugleMarketData({
    apiKey: "test-key",
    fetch,
    now: () => DURING_SESSION,
  });

  const candles = await provider.getCandles({
    symbol: TSMC,
    interval: Interval.FiveMinutes,
    from: "2026-09-24",
    to: "2026-09-29",
  });

  expect(candles.map((candle) => candle.volume)).toEqual([
    400_000, 2_165_000, 5_651_000, 505_000,
  ]);
  expect(candles[2].time).toBe(Date.parse("2026-09-29T01:00:00Z") / 1000);
  expect(requestTo(requests, "historical")?.searchParams.get("timeframe")).toBe(
    "5"
  );
  expect(requestTo(requests, "intraday")?.searchParams.get("timeframe")).toBe(
    "5"
  );
});

test("today's daily bar is built from the session's hourly bars", async () => {
  const { fetch, requests } = fakeFugle([
    {
      path: "/historical/candles/2330",
      body: JSON.stringify({ data: [bar("2026-09-24", 2475, 14_557_662)] }),
    },
    {
      path: "/intraday/candles/2330",
      body: JSON.stringify({
        date: "2026-09-29",
        data: [
          {
            date: "2026-09-29T09:00:00.000+08:00",
            open: 2475,
            high: 2490,
            low: 2470,
            close: 2480,
            volume: 7000,
          },
          {
            date: "2026-09-29T10:00:00.000+08:00",
            open: 2480,
            high: 2495,
            low: 2465,
            close: 2490,
            volume: 3000,
          },
        ],
      }),
    },
  ]);

  const provider = createFugleMarketData({
    apiKey: "test-key",
    fetch,
    now: () => DURING_SESSION,
  });

  const candles = await provider.getCandles({
    symbol: TSMC,
    interval: Interval.OneDay,
    from: "2026-09-01",
    to: "2026-09-29",
  });

  expect(candles.at(-1)).toEqual({
    time: Date.parse("2026-09-28T16:00:00Z") / 1000,
    open: 2475,
    high: 2495,
    low: 2465,
    close: 2490,
    volume: 10_000_000,
  });
  expect(requestTo(requests, "intraday")?.searchParams.get("timeframe")).toBe(
    "60"
  );
});

test("today's bars already in the history are not repeated", async () => {
  const { fetch } = fakeFugle([
    {
      path: "/historical/candles/2330",
      body: JSON.stringify({
        data: [bar("2026-09-29T09:00:00.000+08:00", 2475, 5651)],
      }),
    },
    {
      path: "/intraday/candles/2330",
      body: JSON.stringify({
        date: "2026-09-29",
        data: [
          bar("2026-09-29T09:00:00.000+08:00", 2475, 5651),
          bar("2026-09-29T09:05:00.000+08:00", 2485, 505),
        ],
      }),
    },
  ]);

  const provider = createFugleMarketData({
    apiKey: "test-key",
    fetch,
    now: () => DURING_SESSION,
  });

  const candles = await provider.getCandles({
    symbol: TSMC,
    interval: Interval.FiveMinutes,
    from: "2026-09-28",
    to: "2026-09-29",
  });

  expect(candles).toHaveLength(2);
});

test("a range that starts today asks only for the session", async () => {
  const { fetch, requests } = fakeFugle([
    {
      path: "/intraday/candles/2330",
      body: JSON.stringify({
        date: "2026-09-29",
        data: [bar("2026-09-29T09:00:00.000+08:00", 2475, 5651)],
      }),
    },
  ]);

  const provider = createFugleMarketData({
    apiKey: "test-key",
    fetch,
    now: () => DURING_SESSION,
  });

  await provider.getCandles({
    symbol: TSMC,
    interval: Interval.FiveMinutes,
    from: "2026-09-29",
    to: "2026-09-29",
  });

  expect(requests.map((url) => url.pathname)).toEqual([
    "/marketdata/v1.0/stock/intraday/candles/2330",
  ]);
});

test("ranges of a year or more are split into shorter requests", async () => {
  const { fetch, requests } = fakeFugle([]);

  const provider = createFugleMarketData({
    apiKey: "test-key",
    fetch,
    now: () => DURING_SESSION,
  });

  await provider.getCandles({
    symbol: TSMC,
    interval: Interval.OneDay,
    from: "2024-01-01",
    to: "2025-12-31",
  });

  const ranges = requests
    .map((url) => [url.searchParams.get("from"), url.searchParams.get("to")])
    .toSorted(([left], [right]) => String(left).localeCompare(String(right)));

  expect(ranges).toEqual([
    ["2024-01-01", "2024-12-25"],
    ["2024-12-26", "2025-12-20"],
    ["2025-12-21", "2025-12-31"],
  ]);
});

test("unexpected payloads are rejected at the boundary", async () => {
  const { fetch } = fakeFugle([
    {
      path: "/historical/candles/2330",
      body: JSON.stringify({ data: [{ date: "2026-09-24", close: "2475" }] }),
    },
  ]);

  const provider = createFugleMarketData({
    apiKey: "test-key",
    fetch,
    now: () => DURING_SESSION,
  });

  await expect(
    provider.getCandles({
      symbol: TSMC,
      interval: Interval.OneDay,
      from: "2026-09-01",
      to: "2026-09-24",
    })
  ).rejects.toThrow();
});

test("symbols Fugle does not list have no candles", async () => {
  const { fetch } = fakeFugle([
    {
      path: "/historical/candles/ZZZZ",
      status: 404,
      body: JSON.stringify({ statusCode: 404, message: "Resource Not Found" }),
    },
    {
      path: "/intraday/candles/ZZZZ",
      status: 404,
      body: JSON.stringify({ statusCode: 404, message: "Resource Not Found" }),
    },
  ]);

  const provider = createFugleMarketData({
    apiKey: "test-key",
    fetch,
    now: () => DURING_SESSION,
  });

  const candles = await provider.getCandles({
    symbol: { market: Market.TW, symbol: "ZZZZ" },
    interval: Interval.OneDay,
    from: "2026-09-01",
    to: "2026-09-29",
  });

  expect(candles).toEqual([]);
});

test("a range without sessions still returns today's bars", async () => {
  const { fetch } = fakeFugle([
    {
      path: "/historical/candles/2330",
      status: 404,
      body: JSON.stringify({ statusCode: 404, message: "Resource Not Found" }),
    },
    {
      path: "/intraday/candles/2330",
      body: JSON.stringify({
        date: "2026-09-29",
        data: [bar("2026-09-29T09:00:00.000+08:00", 2475, 5651)],
      }),
    },
  ]);

  const provider = createFugleMarketData({
    apiKey: "test-key",
    fetch,
    now: () => DURING_SESSION,
  });

  // The weekend of 2026-09-26 has no sessions, which Fugle answers with 404.
  const candles = await provider.getCandles({
    symbol: TSMC,
    interval: Interval.FiveMinutes,
    from: "2026-09-26",
    to: "2026-09-29",
  });

  expect(candles.map((candle) => candle.close)).toEqual([2475]);
});

// Fugle clips weekly bars to the range, so chunks splitting a week once produced two bars with one time.
test("weekly bars merge whole weeks of daily bars and today's session", async () => {
  const { fetch, requests } = fakeFugle([
    {
      path: "/historical/candles/2330",
      body: JSON.stringify({
        data: [
          bar("2026-09-21", 2400, 1000),
          bar("2026-09-24", 2450, 2000),
          bar("2026-09-28", 2460, 3000),
        ],
      }),
    },
    {
      path: "/intraday/candles/2330",
      body: JSON.stringify({
        date: "2026-09-29",
        data: [bar("2026-09-29T09:00:00.000+08:00", 2475, 4)],
      }),
    },
  ]);

  const provider = createFugleMarketData({
    apiKey: "test-key",
    fetch,
    now: () => DURING_SESSION,
  });

  const candles = await provider.getCandles({
    symbol: TSMC,
    interval: Interval.OneWeek,
    from: "2026-09-23",
    to: "2026-09-29",
  });

  const history = requestTo(requests, "historical");

  expect(history?.searchParams.get("timeframe")).toBe("D");
  expect(history?.searchParams.get("from")).toBe("2026-09-21");
  expect(
    candles.map((candle) => [candle.time, candle.close, candle.volume])
  ).toEqual([
    [Date.parse("2026-09-20T16:00:00Z") / 1000, 2450, 3000],
    [Date.parse("2026-09-27T16:00:00Z") / 1000, 2475, 7000],
  ]);
});
