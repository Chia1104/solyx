import { expect, test, vi } from "vite-plus/test";

import { ListingEventKind } from "@solyx/core/calendar";
import type { Dividend, Fundamentals } from "@solyx/core/fundamentals";
import { Market, symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import { createCalendar } from "../src/main/modules/calendar/calendar.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

const FOXCONN = { market: Market.TW, symbol: "2317" };

const MEDIATEK = { market: Market.TW, symbol: "2454" };

function cash(amount: number, cashExDate: string): Dividend {
  return {
    period: "115年第2季",
    announced: "2026-09-25",
    cash: amount,
    stock: 0,
    cashExDate,
    cashPaidOn: null,
    stockExDate: null,
  };
}

function setup(dividends: Record<string, Dividend[]>) {
  const fundamentals: Fundamentals = {
    statements: async () => [],
    monthlyRevenue: async () => [],
    dividends: vi.fn(async (symbol: SymbolRef) => {
      const listed = dividends[symbolKey(symbol)];

      if (!listed) throw new Error("FinMind answered 402");

      return listed;
    }),
  };

  // 2026-10-08 12:00 in Taipei.
  const calendar = createCalendar({
    fundamentals,
    now: () => new Date("2026-10-08T04:00:00Z"),
  });

  return { calendar };
}

test("every listing's events come soonest first, within the days asked for", async () => {
  const { calendar } = setup({
    [symbolKey(TSMC)]: [cash(7, "2026-10-20"), cash(7.5, "2026-12-10")],
    [symbolKey(FOXCONN)]: [cash(5.2, "2026-10-15")],
  });

  const { events, unread } = await calendar.upcoming([TSMC, FOXCONN], 30);

  expect(
    events.map(({ symbol, kind, date }) => [symbol.symbol, kind, date])
  ).toEqual([
    ["2317", ListingEventKind.ExDividend, "2026-10-15"],
    ["2330", ListingEventKind.ExDividend, "2026-10-20"],
  ]);
  expect(unread).toEqual([]);
});

test("a listing that cannot be read is named, and the others' events stay", async () => {
  const { calendar } = setup({
    [symbolKey(TSMC)]: [cash(7, "2026-10-20")],
  });

  const { events, unread } = await calendar.upcoming([TSMC, MEDIATEK], 30);

  expect(events.map(({ symbol }) => symbol)).toEqual([TSMC]);
  expect(unread).toEqual([MEDIATEK]);
});
