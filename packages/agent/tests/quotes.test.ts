import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { contentText } from "@earendil-works/pi-ai";
import type {
  ToolExecutionApi,
  ToolRegistration,
} from "@earendil-works/pi-durable";
import { expect, test, vi } from "vite-plus/test";

import { Market, symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { MarketData } from "@solyx/core/market-data";
import type { AccountSnapshot } from "@solyx/core/order";
import type { SessionQuote } from "@solyx/core/quote";

import { createQuoteTools } from "../src/quotes.ts";
import type { QuoteToolsOptions } from "../src/quotes.ts";
import { AgentToolName } from "../src/wire.ts";

// 2026-10-13 10:42 in Taipei.
const NOW = new Date("2026-10-13T02:42:00Z");

const tw = (symbol: string) => ({ market: Market.TW, symbol });

const TSMC = tw("2330");

const HON_HAI = tw("2317");

const MEDIATEK = tw("2454");

const APPLE = { market: Market.US, symbol: "AAPL" };

const session = (last: number, previousClose: number | null): SessionQuote => ({
  date: "2026-10-13",
  hours: { open: 0, close: 0 },
  line: [],
  last,
  previousClose,
});

const NAMES = new Map([
  [symbolKey(TSMC), "台積電"],
  [symbolKey(HON_HAI), "鴻海"],
  [symbolKey(MEDIATEK), "聯發科"],
]);

const QUOTES = new Map([
  [symbolKey(TSMC), session(1085, 1070)],
  [symbolKey(HON_HAI), session(210, 211.5)],
  [symbolKey(MEDIATEK), session(1300, 1250)],
]);

const ACCOUNT: AccountSnapshot = {
  cash: { TWD: 500_000 },
  positions: [
    { instrument: TSMC, quantity: 2000, avgPrice: 1000 },
    { instrument: HON_HAI, quantity: 5000, avgPrice: 220 },
  ],
};

function setup(overrides: Partial<QuoteToolsOptions> = {}) {
  const quote = vi.fn<QuoteToolsOptions["quote"]>(
    async (symbol) => QUOTES.get(symbolKey(symbol)) ?? null
  );

  const [tool] =
    createQuoteTools({
      quote,
      marketData: {
        listing: vi.fn<MarketData["listing"]>(async (symbol) => {
          const name = NAMES.get(symbolKey(symbol));

          return name ? { name, englishName: null } : null;
        }),
      },
      watchlist: (): SymbolRef[] => [HON_HAI, MEDIATEK],
      desk: { account: async () => ACCOUNT },
      exchangeRate: async () => ({ date: "2026-10-12", twdPerUsd: 32.5 }),
      now: () => NOW,
      ...overrides,
    }).tools ?? [];

  const run = async (params: Parameters<ToolRegistration["execute"]>[0]) => {
    // SAFETY: get_quotes never uses its call's api.
    const api = {} as ToolExecutionApi;
    const result = await tool.execute(params, api, BACKGROUND_CONTEXT);

    return contentText(result.output ?? []);
  };

  return { tool, run, quote };
}

test("quotes what the user holds and watches, each once, with positions marked at the last price", async () => {
  const { tool, run, quote } = setup();

  expect(tool.name).toBe(AgentToolName.GetQuotes);

  const text = await run({});

  expect(quote.mock.calls.map(([symbol]) => symbol.symbol)).toEqual([
    "2330",
    "2317",
    "2454",
  ]);
  expect(text.split("\n")).toEqual([
    "Quotes as_of 2026-10-13 10:42 Taipei, 2026-10-12 22:42 New York, for what the user holds and watches: each listing's newest session against the close before it, largest rise first",
    "Held, each position marked at its last price:",
    "listing,name,session,last,change,percent,shares,average,worth,gain,gain percent,today",
    "TW 2330,台積電,2026-10-13,1085,+15,+1.40%,2000,1000,2170000,+170000,+8.50%,+30000",
    "TW 2317,鴻海,2026-10-13,210,-1.5,-0.71%,5000,220,1050000,-50000,-4.55%,-7500",
    "Held in TWD: worth 3220000 against a cost of 3100000, gain +120000 (+3.87%), today +22500",
    "Not held:",
    "listing,name,session,last,change,percent",
    "TW 2454,聯發科,2026-10-13,1300,+50,+4.00%",
  ]);
});

test("positions held in both currencies are worth something together in TWD at the newest rate", async () => {
  const quotes = new Map([...QUOTES, [symbolKey(APPLE), session(250, 245)]]);

  const account = {
    cash: { TWD: 500_000, USD: 10_000 },
    positions: [
      { instrument: TSMC, quantity: 2000, avgPrice: 1000 },
      { instrument: APPLE, quantity: 100, avgPrice: 200 },
    ],
  };

  const { run } = setup({
    quote: async (symbol) => quotes.get(symbolKey(symbol)) ?? null,
    desk: { account: async () => account },
  });

  expect((await run({})).split("\n")).toContain(
    "Held in all, in TWD at USD/TWD 32.5, the interbank close of 2026-10-12 as Taiwan's central bank published it: worth 2982500"
  );

  const { run: unrated } = setup({
    quote: async (symbol) => quotes.get(symbolKey(symbol)) ?? null,
    desk: { account: async () => account },
    exchangeRate: async () => {
      throw new Error("The central bank answered 503");
    },
  });

  expect((await unrated({})).split("\n")).toContain(
    "Held in all could not be put in TWD, since USD/TWD could not be read (The central bank answered 503)"
  );
});

test("quotes the listings a call names, and says which have no quote", async () => {
  const { run, quote } = setup();

  const text = await run({ symbols: [MEDIATEK, APPLE] });

  expect(quote).toHaveBeenCalledTimes(2);
  expect(text.split("\n")).toEqual([
    "Quotes as_of 2026-10-13 10:42 Taipei, 2026-10-12 22:42 New York, for the listings asked for: each listing's newest session against the close before it, largest rise first",
    "Not held:",
    "listing,name,session,last,change,percent",
    "TW 2454,聯發科,2026-10-13,1300,+50,+4.00%",
    "No quote: US AAPL (no source covers its market or has bars for it)",
  ]);
});

test("a quote that fails leaves the others, and the totals say what they leave out", async () => {
  const { run } = setup({
    quote: async (symbol) => {
      if (symbol.symbol === "2317") throw new Error("Fugle answered 503");

      return QUOTES.get(symbolKey(symbol)) ?? null;
    },
  });

  const lines = (await run({})).split("\n");

  expect(lines).toContain(
    "Held in TWD: worth 2170000 against a cost of 2000000, gain +170000 (+8.50%), today +30000"
  );
  expect(lines.at(-1)).toBe(
    "No quote: TW 2317 (Fugle answered 503); the totals leave out the 1 held among them"
  );
});

test("an account that cannot be read leaves the watchlist's quotes", async () => {
  const { run } = setup({
    desk: {
      account: async () => {
        throw new Error("Fubon did not answer");
      },
    },
  });

  const lines = (await run({})).split("\n");

  expect(lines.slice(1, 4)).toEqual([
    "Not held:",
    "listing,name,session,last,change,percent",
    "TW 2454,聯發科,2026-10-13,1300,+50,+4.00%",
  ]);
  expect(lines.at(-1)).toBe(
    "The account could not be read (Fubon did not answer), so no position is marked."
  );
});

test("a session with no close before it has no change", async () => {
  const { run } = setup({ quote: async () => session(50, null) });

  expect(await run({ symbols: [MEDIATEK] })).toContain(
    "TW 2454,聯發科,2026-10-13,50,n/a,n/a"
  );
});

test("says so when there is nothing to quote", async () => {
  const { run, quote } = setup({
    watchlist: () => [],
    desk: { account: async () => ({ cash: {}, positions: [] }) },
  });

  expect(await run({})).toBe(
    "Nothing to quote: the user holds and watches no listing yet."
  );
  expect(quote).not.toHaveBeenCalled();
});
