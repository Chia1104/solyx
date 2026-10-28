import * as z from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { marketSchema, symbolKey, symbolRefSchema } from "@solyx/core/market";
import type { Market, SymbolRef } from "@solyx/core/market";

import { persistOptions } from "../../app/persist.ts";

/** How many listings opened from search the search offers again. */
const KEPT = 8;

interface ListingSearchStore {
  isOpen: boolean;
  /** What is typed, which starts empty each time the search opens. */
  query: string;
  /** The market the search keeps to; `null` for every market. */
  market: Market | null;
  /** The listings last opened from search, newest first, offered before anything is typed. */
  recent: SymbolRef[];
  open(): void;
  close(): void;
  setQuery(query: string): void;
  setMarket(market: Market | null): void;
  /** Keeps a listing just opened from search at the top of the recent ones. */
  remember(symbol: SymbolRef): void;
}

const persistedSchema = z.object({
  market: marketSchema.nullable(),
  recent: z.array(symbolRefSchema),
});

/**
 * The title bar's listing search, which the title bar, its shortcut and the dialog share. Only the
 * market picked and the listings opened are kept between launches.
 */
export const useListingSearchStore = create<ListingSearchStore>()(
  persist(
    (set) => ({
      isOpen: false,
      query: "",
      market: null,
      recent: [],
      open: () => set({ isOpen: true, query: "" }),
      close: () => set({ isOpen: false }),
      setQuery: (query) => set({ query }),
      setMarket: (market) => set({ market }),
      remember: (symbol) =>
        set(({ recent }) => ({
          recent: [
            symbol,
            ...recent.filter((each) => symbolKey(each) !== symbolKey(symbol)),
          ].slice(0, KEPT),
        })),
    }),
    persistOptions(
      "listing-search",
      persistedSchema,
      ({ market, recent }: ListingSearchStore) => ({ market, recent })
    )
  )
);
