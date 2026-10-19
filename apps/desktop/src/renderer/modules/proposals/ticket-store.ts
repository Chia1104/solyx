import { create } from "zustand";

import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

/** A price picked elsewhere on the page, such as from the book, for the order panel to take. */
export interface PickedPrice {
  /** The listing's `symbolKey`. */
  key: string;
  price: number;
  /** Counts picks, so picking the same price again is a pick too. */
  count: number;
}

interface TicketStore {
  picked: PickedPrice | null;
  pick(symbol: SymbolRef, price: number): void;
}

export const useTicketStore = create<TicketStore>()((set) => ({
  picked: null,
  pick: (symbol, price) =>
    set((state) => ({
      picked: {
        key: symbolKey(symbol),
        price,
        count: (state.picked?.count ?? 0) + 1,
      },
    })),
}));
