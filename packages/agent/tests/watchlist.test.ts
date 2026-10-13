import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { contentText } from "@earendil-works/pi-ai";
import type {
  ToolExecutionApi,
  ToolRegistration,
} from "@earendil-works/pi-durable";
import { expect, test, vi } from "vite-plus/test";

import { Market, symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import { createWatchlistTools } from "../src/watchlist.ts";
import { AgentToolName } from "../src/wire.ts";

type ToolArguments = Parameters<ToolRegistration["execute"]>[0];

const TSMC = { market: Market.TW, symbol: "2330" };

const WISTRON = { market: Market.TW, symbol: "3231" };

const APPLE = { market: Market.US, symbol: "AAPL" };

const NAMES = new Map([
  [symbolKey(TSMC), "台積電"],
  [symbolKey(WISTRON), "緯創"],
  [symbolKey(APPLE), "Apple"],
]);

function setup(watched: SymbolRef[] = [TSMC]) {
  const list = [...watched];
  const asked = vi.fn();

  const { tools = [] } = createWatchlistTools({
    watchlist: {
      list: () => [...list],
      add: (symbol) => void list.push(symbol),
      remove: (symbol) =>
        void list.splice(
          list.findIndex((each) => symbolKey(each) === symbolKey(symbol)),
          1
        ),
    },
    marketData: {
      listing: async (symbol) => {
        const name = NAMES.get(symbolKey(symbol));

        return name ? { name, englishName: null } : null;
      },
    },
  }).extension((tool) => ({
    ...tool,
    async execute(params, api, context) {
      asked(params);

      return tool.execute(params, api, context);
    },
  }));

  async function run(params: ToolArguments) {
    const tool = tools.find(
      (candidate) => candidate.name === AgentToolName.ChangeWatchlist
    );

    if (!tool) throw new Error("No change_watchlist tool");

    const result = await tool.execute(
      params,
      // SAFETY: the watchlist tool reads nothing of the call's api.
      {} as ToolExecutionApi,
      BACKGROUND_CONTEXT
    );

    return { text: contentText(result.output ?? []), details: result.details };
  }

  return { run, list, asked };
}

test("listings are added and removed once the user allows it, each named as the exchange names it", async () => {
  const { run, list, asked } = setup();

  const { text, details } = await run({
    add: [WISTRON, APPLE],
    remove: [TSMC],
  });

  expect(text.split("\n")).toEqual([
    "Now watching: TW 3231 緯創, US AAPL Apple.",
    "No longer watching: TW 2330.",
  ]);
  expect(details).toEqual({ added: [WISTRON, APPLE], removed: [TSMC] });
  expect(list).toEqual([WISTRON, APPLE]);
  expect(asked).toHaveBeenCalledOnce();
});

test("a listing already as asked is left alone, and a call that changes nothing never asks", async () => {
  const { run, list, asked } = setup();

  expect(
    (await run({ add: [TSMC], remove: [APPLE] })).text.split("\n")
  ).toEqual([
    "Already watched: TW 2330.",
    "Not watched, so nothing to remove: US AAPL.",
    "The watchlist is as it was.",
  ]);
  expect(asked).not.toHaveBeenCalled();

  // The same listing named twice is added once.
  await run({ add: [TSMC, WISTRON, WISTRON] });

  expect(list).toEqual([TSMC, WISTRON]);
  expect(asked).toHaveBeenCalledOnce();
});

test("a code no source lists, and a listing both added and removed, are refused before the user is asked", async () => {
  const { run, list, asked } = setup();

  await expect(
    run({ add: [{ market: Market.TW, symbol: "9999" }] })
  ).rejects.toThrow("No market data source lists TW 9999");
  await expect(run({ add: [WISTRON], remove: [WISTRON] })).rejects.toThrow(
    "TW 3231 cannot be both added and removed"
  );

  expect(asked).not.toHaveBeenCalled();
  expect(list).toEqual([TSMC]);
});
