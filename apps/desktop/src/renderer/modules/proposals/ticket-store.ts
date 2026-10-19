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

/** Which of the order panel's tabs a request opens. */
export const TicketTab = {
  Order: "order",
  Exit: "exit",
} as const;

export type TicketTab = (typeof TicketTab)[keyof typeof TicketTab];

/** A sale of shares held, asked for elsewhere, such as from a position's row, for the panel to fill in. */
export interface TicketRequest {
  /** The listing's `symbolKey`. */
  key: string;
  tab: TicketTab;
  shares: number;
}

interface TicketStore {
  picked: PickedPrice | null;
  /** Waits until the listing's panel takes it. */
  request: TicketRequest | null;
  /** The next click on the chart picks its price, once. */
  pickingOnChart: boolean;
  pick(symbol: SymbolRef, price: number): void;
  setPickingOnChart(picking: boolean): void;
  requestSale(symbol: SymbolRef, tab: TicketTab, shares: number): void;
  takeRequest(): void;
}

export const useTicketStore = create<TicketStore>()((set) => ({
  picked: null,
  request: null,
  pickingOnChart: false,
  requestSale: (symbol, tab, shares) =>
    set({ request: { key: symbolKey(symbol), tab, shares } }),
  takeRequest: () => set({ request: null }),
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
