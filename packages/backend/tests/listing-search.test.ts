import { expect, test, vi } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import { searchListings } from "../src/modules/market/listing-search.ts";

const NAMES = [
  { symbol: "2330", name: "台積電" },
  { symbol: "2303", name: "聯電" },
  { symbol: "0050", name: "元大台灣50" },
  { symbol: "006208", name: "富邦台50" },
  { symbol: "00631L", name: "元大台灣50正2" },
];

function sources(us: Record<string, string> = {}) {
  return {
    names: vi.fn(async (market: Market) => (market === Market.TW ? NAMES : [])),
    listing: vi.fn(async ({ symbol }: SymbolRef) =>
      us[symbol] ? { name: us[symbol], englishName: symbol } : null
    ),
  };
}

const codes = (matches: { symbol: SymbolRef }[]) =>
  matches.map(({ symbol }) => `${symbol.market}:${symbol.symbol}`);

test("ranks a code typed whole, then codes it starts, then names it starts, then names holding it", async () => {
  expect(
    codes(await searchListings({ query: "0050", market: null }, sources()))
  ).toEqual(["TW:0050"]);

  expect(
    codes(await searchListings({ query: "00", market: Market.TW }, sources()))
  ).toEqual(["TW:0050", "TW:006208", "TW:00631L"]);

  expect(
    codes(await searchListings({ query: "台50", market: null }, sources()))
  ).toEqual(["TW:006208"]);

  expect(
    codes(await searchListings({ query: "元大台灣", market: null }, sources()))
  ).toEqual(["TW:0050", "TW:00631L"]);
});

test("a code matches whatever case it is typed in", async () => {
  expect(
    await searchListings({ query: "00631l", market: Market.TW }, sources())
  ).toEqual([
    {
      symbol: { market: Market.TW, symbol: "00631L" },
      name: "元大台灣50正2",
      englishName: null,
    },
  ]);
});

test("finds a US listing by its full ticker, first, and asks the US source only for a ticker", async () => {
  const both = sources({ AAPL: "蘋果", "BRK.B": "伯克希爾哈撒韋-B" });

  expect(await searchListings({ query: "aapl", market: null }, both)).toEqual([
    {
      symbol: { market: Market.US, symbol: "AAPL" },
      name: "蘋果",
      englishName: "AAPL",
    },
  ]);
  expect(
    codes(await searchListings({ query: "brk.b", market: Market.US }, both))
  ).toEqual(["US:BRK.B"]);

  await searchListings({ query: "2330", market: null }, both);

  expect(both.listing).not.toHaveBeenCalledWith({
    market: Market.US,
    symbol: "2330",
  });
});

test("keeps to the market asked for", async () => {
  const taiwanOnly = sources({ AAPL: "蘋果" });

  expect(
    await searchListings({ query: "AAPL", market: Market.TW }, taiwanOnly)
  ).toEqual([]);
  expect(taiwanOnly.listing).not.toHaveBeenCalled();

  const usOnly = sources({ AAPL: "蘋果" });

  expect(
    await searchListings({ query: "台積", market: Market.US }, usOnly)
  ).toEqual([]);
  expect(usOnly.names).not.toHaveBeenCalled();
});

test("a market whose source fails leaves the other's matches, and fails only when every market asked does", async () => {
  const failing = sources();

  failing.listing.mockRejectedValue(
    new Error("Longbridge closed the quote connection")
  );

  expect(
    codes(
      await searchListings(
        { query: "T", market: null },
        {
          ...failing,
          names: async () => [{ symbol: "TSMC", name: "Example" }],
        }
      )
    )
  ).toEqual(["TW:TSMC"]);

  await expect(
    searchListings({ query: "AAPL", market: Market.US }, failing)
  ).rejects.toThrow("Longbridge closed the quote connection");
});
