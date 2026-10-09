import { afterEach, expect, test, vi } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import { createNewsCollector } from "../src/main/modules/news/news-collector.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

const FOXCONN = { market: Market.TW, symbol: "2317" };

const HOUR_MS = 60 * 60 * 1000;

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(hours: number) {
  const refresh = vi.fn(
    async (_symbol: SymbolRef, _everyMs: number) => undefined
  );

  const diagnostics = { recovered: vi.fn() };

  const collector = createNewsCollector({
    news: { refresh },
    diagnostics,
    listings: async () => [TSMC, FOXCONN],
    collectEveryHours: () => hours,
  });

  return { collector, refresh, diagnostics };
}

test("each listing held or watched is refreshed in turn at the interval set", async () => {
  const { collector, refresh } = setup(72);

  await collector.run();

  expect(refresh.mock.calls).toEqual([
    [TSMC, 72 * HOUR_MS],
    [FOXCONN, 72 * HOUR_MS],
  ]);
});

test("an interval of 0 refreshes nothing", async () => {
  const { collector, refresh } = setup(0);

  await collector.run();

  expect(refresh).not.toHaveBeenCalled();
});

test("a listing whose refresh fails is logged by its listing and leaves the rest refreshed", async () => {
  const { collector, refresh, diagnostics } = setup(72);
  const failure = new Error("decisions model down");

  refresh.mockRejectedValueOnce(failure);
  await collector.run();

  expect(diagnostics.recovered).toHaveBeenCalledWith(failure, "news.collect", {
    "solyx.listing": "TW:2330",
  });
  expect(refresh).toHaveBeenLastCalledWith(FOXCONN, 72 * HOUR_MS);
});
