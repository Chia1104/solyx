import { describe, expect, test } from "vite-plus/test";

import type { Candle } from "../src/candles.ts";
import { Market } from "../src/market.ts";
import { sessionQuote } from "../src/quote.ts";

/** A five-minute bar opening at `hhmm` Taipei time on `date`. */
function bar(date: string, hhmm: string, close: number): Candle {
  return {
    time: Date.parse(`${date}T${hhmm}:00+08:00`) / 1000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 100,
  };
}

const seconds = (iso: string) => Date.parse(iso) / 1000;

describe("sessionQuote", () => {
  test("reads the newest session against the last close of the one before", () => {
    const quote = sessionQuote(Market.TW, [
      bar("2026-10-02", "13:20", 1060),
      bar("2026-10-02", "13:25", 1070),
      bar("2026-10-05", "09:00", 1075),
      bar("2026-10-05", "09:05", 1080),
      bar("2026-10-05", "09:10", 1085),
    ]);

    expect(quote).toEqual({
      date: "2026-10-05",
      hours: {
        open: seconds("2026-10-05T09:00:00+08:00"),
        close: seconds("2026-10-05T13:30:00+08:00"),
      },
      line: [
        { time: seconds("2026-10-05T09:00:00+08:00"), close: 1075 },
        { time: seconds("2026-10-05T09:05:00+08:00"), close: 1080 },
        { time: seconds("2026-10-05T09:10:00+08:00"), close: 1085 },
      ],
      last: 1085,
      previousClose: 1070,
    });
  });

  test("has no close before a session the bars start with", () => {
    const quote = sessionQuote(Market.TW, [
      bar("2026-10-05", "09:00", 1075),
      bar("2026-10-05", "09:05", 1080),
    ]);

    expect(quote?.previousClose).toBeNull();
    expect(quote?.line).toHaveLength(2);
  });

  test("is null without bars", () => {
    expect(sessionQuote(Market.TW, [])).toBeNull();
  });

  test("spans New York's regular hours in daylight saving time", () => {
    const time = seconds("2026-07-01T10:00:00-04:00");

    const quote = sessionQuote(Market.US, [
      { time, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ]);

    expect(quote?.hours).toEqual({
      open: seconds("2026-07-01T09:30:00-04:00"),
      close: seconds("2026-07-01T16:00:00-04:00"),
    });
  });
});
