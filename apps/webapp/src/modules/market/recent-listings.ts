import * as z from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { symbolKey, symbolRefSchema } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import { persistOptions } from "../../app/persist.ts";

/** How many listings opened from search the search offers again. */
const KEPT = 8;

interface RecentListings {
  /** Newest first. */
  listings: SymbolRef[];
  remember(symbol: SymbolRef): void;
}

const persistedSchema = z.object({ listings: z.array(symbolRefSchema) });

/** The listings last opened from search, offered again before anything is typed. */
export const useRecentListings = create<RecentListings>()(
  persist(
    (set) => ({
      listings: [],
      remember: (symbol) =>
        set(({ listings }) => ({
          listings: [
            symbol,
            ...listings.filter((each) => symbolKey(each) !== symbolKey(symbol)),
          ].slice(0, KEPT),
        })),
    }),
    persistOptions<RecentListings>("recent-listings", persistedSchema)
  )
);
