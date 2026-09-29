import { noop } from "es-toolkit";
import { expect, test } from "vite-plus/test";

import { Interval } from "@solyx/core/candles";
import { Market } from "@solyx/core/market";
import type { MinuteListener } from "@solyx/core/market-data";

import {
  FUBON_PLAN,
  createFubonMarketData,
  createFubonStream,
} from "../src/fubon.ts";
import type { StreamSocket } from "../src/fugle-api.ts";

const REALTIME = {
  sdkToken: "session-token",
  restBaseUrl: "https://rest.example.test/marketdata",
  streamBaseUrl: "wss://stream.example.test/marketdata",
};

const LISTENER: MinuteListener = { onSession: noop, onMinute: noop };

test("history is asked of the session's endpoint with its token", async () => {
  const requests: Request[] = [];

  const provider = createFubonMarketData({
    realtime: REALTIME,
    now: () => new Date("2026-09-29T02:00:00Z"),
    fetch: async (input) => {
      requests.push(new Request(input));

      return Response.json({
        data: [
          { date: "2026-09-25", open: 1, high: 1, low: 1, close: 1, volume: 1 },
        ],
      });
    },
  });

  const bars = await provider.getCandles({
    symbol: { market: Market.TW, symbol: "2330" },
    interval: Interval.OneDay,
    from: "2026-09-25",
    to: "2026-09-25",
  });

  expect(provider.id).toBe("fubon");
  expect(bars).toHaveLength(1);
  expect(requests).toHaveLength(1);
  expect(new URL(requests[0].url).pathname).toBe(
    "/marketdata/v1.0/stock/historical/candles/2330"
  );
  expect(requests[0].headers.get("X-SDK-TOKEN")).toBe("session-token");
  expect(requests[0].headers.has("X-API-KEY")).toBe(false);
});

test("the stream signs in with the session token and takes the plan's symbols", () => {
  const urls: string[] = [];
  const sent: unknown[] = [];
  const opened: ((event: { data?: unknown }) => void)[] = [];

  const socket: StreamSocket = {
    send: (data) => sent.push(JSON.parse(data)),
    close: noop,
    addEventListener(type, listener) {
      if (type === "open") opened.push(listener);
    },
  };

  const stream = createFubonStream({
    realtime: REALTIME,
    connect: (url) => {
      urls.push(url);

      return socket;
    },
  });

  const watches = Array.from({ length: FUBON_PLAN.streamSymbols + 1 }, (_, i) =>
    stream.watchMinutes(
      { market: Market.TW, symbol: String(1000 + i) },
      LISTENER
    )
  );

  for (const listener of opened) listener({});

  expect(urls).toEqual([
    "wss://stream.example.test/marketdata/v1.0/stock/streaming",
  ]);
  expect(sent).toEqual([
    { event: "auth", data: { sdkToken: "session-token" } },
  ]);
  expect(watches.filter(Boolean)).toHaveLength(FUBON_PLAN.streamSymbols);
  expect(watches.at(-1)).toBeUndefined();

  stream.close();
});
