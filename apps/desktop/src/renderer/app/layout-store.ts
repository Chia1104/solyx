import { clamp } from "es-toolkit";
import * as z from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { SplitterEdge } from "../components/pane-splitter.tsx";

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

export interface PaneLimits {
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

const paneStateSchema = z.object({
  width: z.number(),
  open: z.boolean(),
});

type PaneState = z.infer<typeof paneStateSchema>;

interface LayoutState {
  panes: Record<Pane, PaneState>;
}

interface LayoutActions {
  setWidth: (pane: Pane, width: number) => void;
  toggle: (pane: Pane) => void;
}

export type LayoutStore = LayoutState & LayoutActions;

const defaultState: LayoutState = {
  panes: {
    [Pane.Symbols]: { width: PANE_LIMITS[Pane.Symbols].default, open: true },
    [Pane.Agent]: { width: PANE_LIMITS[Pane.Agent].default, open: true },
  },
};

const persistedLayoutSchema = z.object({
  panes: z.object({
    [Pane.Symbols]: paneStateSchema,
    [Pane.Agent]: paneStateSchema,
  }),
});

export function clampPaneWidth(pane: Pane, width: number) {
  const limits = PANE_LIMITS[pane];

  return Math.round(clamp(width, limits.min, limits.max));
}

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
              width: clampPaneWidth(pane, width),
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
    {
      name: "solyx.workspace-layout",
      version: 1,
      // Local storage outlives app versions, so anything that no longer parses is dropped.
      merge: (persisted, current) => ({
        ...current,
        ...persistedLayoutSchema.safeParse(persisted).data,
      }),
    }
  )
);
