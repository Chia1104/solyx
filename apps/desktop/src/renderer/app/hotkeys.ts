import type { RefObject } from "react";

import { useHotkeys } from "@tanstack/react-hotkeys";
import type { Hotkey } from "@tanstack/react-hotkeys";

import { Pane, useLayoutStore } from "./layout-store.ts";

export const PANE_HOTKEY: Record<Pane, Hotkey> = {
  [Pane.Symbols]: "Mod+B",
  [Pane.Agent]: "Mod+I",
};

const SEARCH_HOTKEY: Hotkey = "Mod+K";

/** ⌘B and ⌘I show or hide the side panes and ⌘K jumps to symbol search, with Ctrl off macOS. */
export function useWorkspaceHotkeys(
  search: RefObject<HTMLInputElement | null>
) {
  const toggle = useLayoutStore((state) => state.toggle);

  useHotkeys([
    { hotkey: SEARCH_HOTKEY, callback: () => search.current?.focus() },
    ...Object.values(Pane).map((pane) => ({
      hotkey: PANE_HOTKEY[pane],
      callback: () => toggle(pane),
    })),
  ]);
}
