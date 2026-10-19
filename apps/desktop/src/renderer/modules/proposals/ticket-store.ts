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
  /** The next click on the chart picks its price, once. */
  pickingOnChart: boolean;
  pick(symbol: SymbolRef, price: number): void;
  setPickingOnChart(picking: boolean): void;
}

export const useTicketStore = create<TicketStore>()((set) => ({
  picked: null,
  pickingOnChart: false,
  setPickingOnChart: (pickingOnChart) => set({ pickingOnChart }),
  pick: (symbol, price) =>
    set((state) => ({
      picked: {
        key: symbolKey(symbol),
        price,
        count: (state.picked?.count ?? 0) + 1,
      },
    })),
}));
