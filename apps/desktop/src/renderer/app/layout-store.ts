import { clamp, mapValues } from "es-toolkit";
import * as z from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";

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

/** Dragging stops before the main view gets narrower than this. */
export const MAIN_MIN_WIDTH = 480;

interface PaneState {
  width: number;
  open: boolean;
}

interface LayoutState {
  panes: Record<Pane, PaneState>;
}

interface LayoutActions {
  setWidth: (pane: Pane, width: number) => void;
  toggle: (pane: Pane) => void;
}

type LayoutStore = LayoutState & LayoutActions;

function clampWidth(limits: PaneLimits, width: number) {
  return Math.round(clamp(width, limits.min, limits.max));
}

const defaultState: LayoutState = {
  panes: mapValues(PANE_LIMITS, (limits) => ({
    width: limits.default,
    open: true,
  })),
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
    }),
    persistOptions<LayoutStore>("workspace-layout", persistedLayoutSchema)
  )
);
