import { expect, test, vi } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import { messageContext } from "../src/main/modules/agent/message-context.ts";
import type { MessageContextSources } from "../src/main/modules/agent/message-context.ts";

const listing = (market: Market, symbol: string): SymbolRef => ({
  market,
  symbol,
});

function sources(change: Partial<MessageContextSources> = {}) {
  return {
    focus: { symbol: listing(Market.TW, "2317"), name: "鴻海" },
    watchlist: () => [listing(Market.TW, "2330"), listing(Market.US, "NVDA")],
    holdings: vi.fn(async () => [listing(Market.TW, "2454")]),
    name: vi.fn(async (symbol: SymbolRef) =>
      symbol.symbol === "2330" ? "台積電" : undefined
    ),
    commands: vi.fn(async () => ["deep-analysis"]),
    ...change,
  } satisfies MessageContextSources;
}

test("codes resolve against the screen and the watchlist without reading the account", async () => {
  const from = sources();

  expect(
    await messageContext("/deep-analysis @2317 和 @2330、@nvda", from)
  ).toEqual({
    mentions: [
      { symbol: listing(Market.TW, "2317"), name: "鴻海" },
      { symbol: listing(Market.TW, "2330"), name: "台積電" },
      { symbol: listing(Market.US, "NVDA") },
    ],
    skill: "deep-analysis",
  });
  expect(from.holdings).not.toHaveBeenCalled();
  expect(from.name).not.toHaveBeenCalledWith(listing(Market.TW, "2317"));
});

test("a code only the account holds is read from it, and one nobody knows stays text", async () => {
  const from = sources();

  expect(await messageContext("@2454 跟 @9999", from)).toEqual({
    mentions: [{ symbol: listing(Market.TW, "2454") }],
    skill: undefined,
  });
  expect(from.holdings).toHaveBeenCalledOnce();
  expect(from.commands).not.toHaveBeenCalled();
});

test("a skill the user may not ask for is not named, and failing sources leave out only what they knew", async () => {
  expect(
    await messageContext(
      "/taiwan-market @2454 @2330",
      sources({
        holdings: () => Promise.reject(new Error("broker offline")),
        name: () => Promise.reject(new Error("no source")),
      })
    )
  ).toEqual({
    mentions: [{ symbol: listing(Market.TW, "2330") }],
    skill: undefined,
  });
});
