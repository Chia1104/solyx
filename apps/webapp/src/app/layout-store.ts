import { clamp, mapValues } from "es-toolkit";
import * as z from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { marketSchema } from "@solyx/core/market";
import type { Market } from "@solyx/core/market";

import { SplitterEdge } from "../components/pane-splitter.tsx";

import { persistOptions } from "./persist.ts";

/** The workspace's side panes; the main view between them never collapses. */
export const Pane = {
  Symbols: "symbols",
  Agent: "agent",
} as const;

export type Pane = (typeof Pane)[keyof typeof Pane];

export const PANE_EDGE: Record<Pane, SplitterEdge> = {
  [Pane.Symbols]: SplitterEdge.Start,
  [Pane.Agent]: SplitterEdge.End,
};

/** The pane element's id, which its toggle and splitter point to. */
export const paneId = (pane: Pane) => `pane-${pane}`;

interface PaneLimits {
  min: number;
  max: number;
  default: number;
}

export const PANE_LIMITS: Record<Pane, PaneLimits> = {
  [Pane.Symbols]: { min: 200, max: 360, default: 240 },
  [Pane.Agent]: { min: 320, max: 560, default: 380 },
};

/** How many days the overview's agenda shows at once. */
export const AgendaView = {
  Week: "week",
  Month: "month",
} as const;

export type AgendaView = (typeof AgendaView)[keyof typeof AgendaView];

/** What the symbols pane draws a watchlist category's dot as, which the user picks for it. */
export const CategoryIcon = {
  Dot: "dot",
  Star: "star",
  Chart: "chart",
  Briefcase: "briefcase",
  Globe: "globe",
  Flag: "flag",
  Flame: "flame",
  Bookmark: "bookmark",
  Rocket: "rocket",
  Diamond: "diamond",
} as const;

export type CategoryIcon = (typeof CategoryIcon)[keyof typeof CategoryIcon];

/** Dragging stops before the main view gets narrower than this. */
export const MAIN_MIN_WIDTH = 480;

/** The symbol page's news under its chart and the gap above it; at its least only the news's header row shows. */
export const NEWS_HEIGHT = { min: 48, default: 256 };

/** The symbol page's book beside its chart; its most is also capped by the room the chart leaves. */
export const BOOK_WIDTH = { min: 200, max: 400, default: 240 };

interface PaneState {
  width: number;
  open: boolean;
}

interface LayoutState {
  panes: Record<Pane, PaneState>;
  newsHeight: number;
  bookWidth: number;
  agendaView: AgendaView;
  /** Whether the symbol page shows its quote, book and position beside the chart. */
  tradeRail: boolean;
  /** The market the symbols pane keeps to; `null` for every market, each under its own heading. */
  symbolsMarket: Market | null;
  /** The icon picked for each watchlist category, by its key; one not here is a dot. */
  categoryIcons: Record<string, CategoryIcon>;
}

interface LayoutActions {
  setWidth: (pane: Pane, width: number) => void;
  toggle: (pane: Pane) => void;
  /** Opens the pane where it is closed. */
  show: (pane: Pane) => void;
  setNewsHeight: (height: number) => void;
  setBookWidth: (width: number) => void;
  setAgendaView: (view: AgendaView) => void;
  toggleTradeRail: () => void;
  setSymbolsMarket: (market: Market | null) => void;
  setCategoryIcon: (category: string, icon: CategoryIcon) => void;
}

type LayoutStore = LayoutState & LayoutActions;

function clampWidth(limits: PaneLimits, width: number) {
  return Math.round(clamp(width, limits.min, limits.max));
}

// Its most is the room the chart leaves, which only the page can measure.
function clampNewsHeight(height: number) {
  return Math.round(Math.max(height, NEWS_HEIGHT.min));
}

function clampBookWidth(width: number) {
  return Math.round(clamp(width, BOOK_WIDTH.min, BOOK_WIDTH.max));
}

const defaultState: LayoutState = {
  panes: mapValues(PANE_LIMITS, (limits) => ({
    width: limits.default,
    open: true,
  })),
  newsHeight: NEWS_HEIGHT.default,
  bookWidth: BOOK_WIDTH.default,
  agendaView: AgendaView.Week,
  tradeRail: true,
  symbolsMarket: null,
  categoryIcons: {},
};

// Limits can change between versions, so saved widths are clamped as they load.
const persistedLayoutSchema = z.object({
  panes: z.object(
    mapValues(PANE_LIMITS, (limits) =>
      z.object({
        width: z.number().transform((width) => clampWidth(limits, width)),
        open: z.boolean(),
      })
    )
  ),
  // Caught on its own, so a height that does not parse leaves the saved pane widths.
  newsHeight: z.number().transform(clampNewsHeight).catch(NEWS_HEIGHT.default),
  bookWidth: z.number().transform(clampBookWidth).catch(BOOK_WIDTH.default),
  agendaView: z.enum(AgendaView).catch(AgendaView.Week),
  tradeRail: z.boolean().catch(true),
  symbolsMarket: marketSchema.nullable().catch(null),
  categoryIcons: z.record(z.string(), z.enum(CategoryIcon)).catch({}),
});

export const useLayoutStore = create<LayoutStore>()(
  persist(
    (set) => ({
      ...defaultState,
      setWidth: (pane, width) =>
        set((state) => ({
          panes: {
            ...state.panes,
            [pane]: {
              ...state.panes[pane],
              width: clampWidth(PANE_LIMITS[pane], width),
            },
          },
        })),
      toggle: (pane) =>
        set((state) => ({
          panes: {
            ...state.panes,
            [pane]: { ...state.panes[pane], open: !state.panes[pane].open },
          },
        })),
      show: (pane) =>
        set((state) => ({
          panes: {
            ...state.panes,
            [pane]: { ...state.panes[pane], open: true },
          },
        })),
      setNewsHeight: (height) => set({ newsHeight: clampNewsHeight(height) }),
      setBookWidth: (width) => set({ bookWidth: clampBookWidth(width) }),
      setAgendaView: (agendaView) => set({ agendaView }),
      toggleTradeRail: () => set((state) => ({ tradeRail: !state.tradeRail })),
      setSymbolsMarket: (symbolsMarket) => set({ symbolsMarket }),
      setCategoryIcon: (category, icon) =>
        set((state) => ({
          categoryIcons: { ...state.categoryIcons, [category]: icon },
        })),
    }),
    persistOptions<LayoutStore>("workspace-layout", persistedLayoutSchema)
  )
);
