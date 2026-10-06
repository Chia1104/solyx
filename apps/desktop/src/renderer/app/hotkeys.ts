import type { RefObject } from "react";

import { useHotkeys } from "@tanstack/react-hotkeys";
import type { Hotkey } from "@tanstack/react-hotkeys";

import { Pane, useLayoutStore } from "./layout-store.ts";

export const PANE_HOTKEY: Record<Pane, Hotkey> = {
  [Pane.Symbols]: "Mod+B",
  [Pane.Agent]: "Mod+I",
};

const SEARCH_HOTKEY: Hotkey = "Mod+K";

/** Set on `<html>` for the frames that apply a pane toggled by keyboard, so the panes snap instead of sliding. */
const PANE_AT_ONCE_ATTRIBUTE = "data-pane-at-once";

function toggleAtOnce(toggle: () => void) {
  const root = document.documentElement;

  root.setAttribute(PANE_AT_ONCE_ATTRIBUTE, "");
  toggle();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => root.removeAttribute(PANE_AT_ONCE_ATTRIBUTE))
  );
}

/**
 * ⌘B and ⌘I show or hide the side panes and ⌘K jumps to symbol search, with Ctrl off macOS. A
 * keyboard toggle is instant, since a shortcut is for getting somewhere fast; the title bar's
 * buttons slide the panes.
 */
export function useWorkspaceHotkeys(
  search: RefObject<HTMLInputElement | null>
) {
  const toggle = useLayoutStore((state) => state.toggle);

  useHotkeys([
    { hotkey: SEARCH_HOTKEY, callback: () => search.current?.focus() },
    ...Object.values(Pane).map((pane) => ({
      hotkey: PANE_HOTKEY[pane],
      callback: () => toggleAtOnce(() => toggle(pane)),
    })),
  ]);
}
