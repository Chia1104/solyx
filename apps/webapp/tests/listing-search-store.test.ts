import { expect, test, vi } from "vite-plus/test";

import { Market } from "@solyx/core/market";

// The store saves through `window.localStorage`, which Node lacks.
const saved = new Map<string, string>();

vi.stubGlobal("window", {
  localStorage: {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  },
});

const { useListingSearchStore } =
  await import("../src/modules/market/listing-search-store.ts");

const listing = (symbol: string, market = Market.TW) => ({ market, symbol });

test("opening starts from an empty query and keeps the market picked", () => {
  const store = useListingSearchStore.getState();

  store.setMarket(Market.US);
  store.setQuery("AAPL");
  store.close();
  store.open();

  expect(useListingSearchStore.getState()).toMatchObject({
    isOpen: true,
    query: "",
    market: Market.US,
  });
});

test("keeps the last eight listings opened, newest first, each once", () => {
  const { remember } = useListingSearchStore.getState();

  for (const code of [
    "1101",
    "1102",
    "1216",
    "1301",
    "1303",
    "2002",
    "2303",
    "2317",
  ]) {
    remember(listing(code));
  }

  remember(listing("2330"));
  remember(listing("1216"));

  expect(
    useListingSearchStore.getState().recent.map(({ symbol }) => symbol)
  ).toEqual(["1216", "2330", "2317", "2303", "2002", "1303", "1301", "1102"]);
});

test("saves only the market picked and the listings opened", () => {
  useListingSearchStore.getState().open();

  expect(
    Object.keys(
      JSON.parse(saved.get("solyx.listing-search") ?? "{}").state ?? {}
    ).toSorted()
  ).toEqual(["market", "recent"]);
});
