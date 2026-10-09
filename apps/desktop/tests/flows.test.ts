import { expect, test, vi } from "vite-plus/test";

import type { FlowsProvider } from "@solyx/core/flows";
import { Market } from "@solyx/core/market";
import { memoryAnswers } from "@solyx/utils/fresh";

import { createFlows } from "../src/main/modules/flows/flows.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

const HOUR_MS = 60 * 60 * 1000;

function setup(answers = memoryAnswers()) {
  // 2026-10-07 10:00 in Taipei.
  const clock = { now: Date.parse("2026-10-07T02:00:00Z") };

  const provider = {
    id: "fake",
    markets: [Market.TW],
    getListingFlows: vi.fn<FlowsProvider["getListingFlows"]>(async () => ({
      trades: [],
      margin: [],
      foreign: [],
    })),
    getMarketFlows: vi.fn<FlowsProvider["getMarketFlows"]>(async () => ({
      trades: [],
      margin: [],
      futures: [],
    })),
  };

  const flows = createFlows({
    providers: [provider],
    answers,
    now: () => new Date(clock.now),
  });

  return { clock, provider, flows };
}

test("asks the market's provider for a year of a listing's and the market's flows", async () => {
  const { provider, flows } = setup();

  await flows.listing(TSMC);
  await flows.market(Market.TW);

  expect(provider.getListingFlows).toHaveBeenCalledWith(TSMC, "2025-10-07");
  expect(provider.getMarketFlows).toHaveBeenCalledWith(Market.TW, "2025-10-07");
});

test("keeps an answer until a session's next figures come out", async () => {
  const { clock, provider, flows } = setup();
  const asked = () => provider.getListingFlows.mock.calls.length;

  await flows.listing(TSMC);
  clock.now += 5 * HOUR_MS;
  await flows.listing(TSMC);

  expect(asked()).toBe(1);

  // 15:45, after the market's institutions are in.
  clock.now += 0.75 * HOUR_MS;
  await flows.listing(TSMC);
  clock.now += 2 * HOUR_MS;
  await flows.listing(TSMC);

  expect(asked()).toBe(2);

  // 22:00, after the rest are in; it then serves through the next morning.
  clock.now += 4.25 * HOUR_MS;
  await flows.listing(TSMC);
  clock.now += 12 * HOUR_MS;
  await flows.listing(TSMC);

  expect(asked()).toBe(3);
});

test("an answer kept serves the next run over the same answers", async () => {
  const answers = memoryAnswers();

  await setup(answers).flows.market(Market.TW);

  const next = setup(answers);

  await next.flows.market(Market.TW);

  expect(next.provider.getMarketFlows).not.toHaveBeenCalled();
});

test("a market no provider covers has no flows, and costs no request", async () => {
  const { provider, flows } = setup();

  expect(await flows.listing({ market: Market.US, symbol: "AAPL" })).toEqual({
    trades: [],
    margin: [],
    foreign: [],
  });
  expect(await flows.market(Market.US)).toEqual({
    trades: [],
    margin: [],
    futures: [],
  });
  expect(provider.getListingFlows).not.toHaveBeenCalled();
  expect(provider.getMarketFlows).not.toHaveBeenCalled();
});
