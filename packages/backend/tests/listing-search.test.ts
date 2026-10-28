import { expect, test, vi } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import { searchListings } from "../src/modules/market/listing-search.ts";
import type { ListingEntry } from "../src/modules/market/listing-search.ts";

const taiwan = (symbol: string, name: string): ListingEntry => ({
  symbol,
  name,
  englishName: null,
});

const DIRECTORY: Record<Market, ListingEntry[]> = {
  [Market.TW]: [
    taiwan("2330", "台積電"),
    taiwan("2303", "聯電"),
    taiwan("0050", "元大台灣50"),
    taiwan("006208", "富邦台50"),
    taiwan("00631L", "元大台灣50正2"),
  ],
  [Market.US]: [
    { symbol: "AAPL", name: "蘋果", englishName: "Apple Inc." },
    { symbol: "TSM", name: "台積電", englishName: "Taiwan Semiconductor" },
    {
      symbol: "BRK.B",
      name: "伯克希爾哈撒韋-B",
      englishName: "Berkshire Hathaway",
    },
    {
      symbol: "QQQ",
      name: "納指 100 ETF - Invesco",
      englishName: "Invesco QQQ Trust",
    },
  ],
};

// A ticker the directory lacks, as one traded over the counter, which the source still names.
const OVER_THE_COUNTER = new Map([["TCEHY", "騰訊控股 ADR"]]);

function sources() {
  return {
    directory: vi.fn(async (market: Market) => DIRECTORY[market]),
    listing: vi.fn(async ({ symbol }: SymbolRef) => {
      const name = OVER_THE_COUNTER.get(symbol);

      return name ? { name, englishName: null } : null;
    }),
  };
}

const codes = (matches: { symbol: SymbolRef }[]) =>
  matches.map(({ symbol }) => `${symbol.market}:${symbol.symbol}`);

const search = async (query: string, market: Market | null = null) =>
  codes(await searchListings({ query, market }, sources()));

test("ranks a code typed whole, then codes it starts, then names it starts, then names holding it", async () => {
  expect(await search("0050")).toEqual(["TW:0050"]);
  expect(await search("00", Market.TW)).toEqual([
    "TW:0050",
    "TW:006208",
    "TW:00631L",
  ]);
  expect(await search("台50")).toEqual(["TW:006208"]);
  expect(await search("元大台灣")).toEqual(["TW:0050", "TW:00631L"]);
});

test("matches a code in any case, and a US listing by its Chinese or English name", async () => {
  expect(await search("00631l")).toEqual(["TW:00631L"]);
  expect(await search("aapl")).toEqual(["US:AAPL"]);
  expect(await search("蘋果")).toEqual(["US:AAPL"]);
  expect(await search("invesco")).toEqual(["US:QQQ"]);
  expect(await search("brk.b")).toEqual(["US:BRK.B"]);
});

test("lists every market's matches in one ranking", async () => {
  expect(await search("台積")).toEqual(["TW:2330", "US:TSM"]);
});

test("finds a US ticker the directory lacks by asking for it whole, and only then", async () => {
  const asked = sources();

  expect(
    codes(await searchListings({ query: "tcehy", market: null }, asked))
  ).toEqual(["US:TCEHY"]);

  await searchListings({ query: "AAPL", market: null }, asked);
  await searchListings({ query: "2330", market: null }, asked);

  expect(asked.listing.mock.calls.map(([symbol]) => symbol.symbol)).toEqual([
    "TCEHY",
  ]);
});

test("keeps to the market asked for", async () => {
  const asked = sources();

  expect(
    await searchListings({ query: "AAPL", market: Market.TW }, asked)
  ).toEqual([]);
  expect(asked.directory.mock.calls).toEqual([[Market.TW]]);
  expect(asked.listing).not.toHaveBeenCalled();
});

test("a market whose source fails leaves the other's matches, and fails only when every market asked does", async () => {
  const failing = sources();

  failing.directory.mockImplementation(async (market) => {
    if (market === Market.US) {
      throw new Error("Longbridge closed the quote connection");
    }

    return DIRECTORY[market];
  });

  expect(
    codes(await searchListings({ query: "台積", market: null }, failing))
  ).toEqual(["TW:2330"]);

  await expect(
    searchListings({ query: "AAPL", market: Market.US }, failing)
  ).rejects.toThrow("Longbridge closed the quote connection");
});
