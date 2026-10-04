import { noop } from "es-toolkit";
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

  const collector = createNewsCollector({
    news: { refresh },
    watchlist: () => [TSMC, FOXCONN],
    collectEveryHours: () => hours,
  });

  return { collector, refresh };
}

test("each watched listing is refreshed in turn at the interval set", async () => {
  const { collector, refresh } = setup(72);

  await collector.check();

  expect(refresh.mock.calls).toEqual([
    [TSMC, 72 * HOUR_MS],
    [FOXCONN, 72 * HOUR_MS],
  ]);
});

test("an interval of 0 refreshes nothing", async () => {
  const { collector, refresh } = setup(0);

  await collector.check();

  expect(refresh).not.toHaveBeenCalled();
});

test("a listing whose refresh fails leaves the rest refreshed", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(noop);
  const { collector, refresh } = setup(72);

  refresh.mockRejectedValueOnce(new Error("decisions model down"));
  await collector.check();

  expect(error).toHaveBeenCalledWith(
    "News collection for TW 2330 failed: decisions model down"
  );
  expect(refresh).toHaveBeenLastCalledWith(FOXCONN, 72 * HOUR_MS);
});
