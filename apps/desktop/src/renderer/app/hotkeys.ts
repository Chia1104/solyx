import { useEffect } from "react";
import type { RefObject } from "react";

import { useHotkeys } from "@tanstack/react-hotkeys";
import type { Hotkey } from "@tanstack/react-hotkeys";
import { useRouter } from "@tanstack/react-router";

import { Pane, useLayoutStore } from "./layout-store.ts";
import { useHeldPane } from "./settings-open.ts";

export const PANE_HOTKEY: Record<Pane, Hotkey> = {
  [Pane.Symbols]: "Mod+B",
  [Pane.Agent]: "Mod+I",
};

const SEARCH_HOTKEY: Hotkey = "Mod+K";

/** ⌘[ as on macOS and Alt+← as on Windows and Linux, both bound everywhere. */
export const BACK_HOTKEYS: Hotkey[] = ["Mod+[", "Alt+ArrowLeft"];

// The mouse's back button, which Chromium reports as button 3 and Electron leaves alone.
const BACK_BUTTON = 3;

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
 * ⌘B and ⌘I show or hide the side panes, but for one held open, and ⌘K jumps to symbol search,
 * with Ctrl off macOS. A keyboard toggle is instant, since a shortcut is for getting somewhere
 * fast; the title bar's buttons slide the panes. The back shortcuts and the mouse's back button
 * go back a page.
 */
export function useWorkspaceHotkeys(
  search: RefObject<HTMLInputElement | null>
) {
  const toggle = useLayoutStore((state) => state.toggle);
  const held = useHeldPane();
  const { history } = useRouter();

  const back = () => {
    if (history.canGoBack()) history.back();
  };

  useHotkeys([
    { hotkey: SEARCH_HOTKEY, callback: () => search.current?.focus() },
    ...Object.values(Pane).map((pane) => ({
      hotkey: PANE_HOTKEY[pane],
      callback: () => {
        if (pane !== held) toggleAtOnce(() => toggle(pane));
      },
    })),
    ...BACK_HOTKEYS.map((hotkey) => ({ hotkey, callback: back })),
  ]);

  useEffect(() => {
    const onMouseUp = (event: MouseEvent) => {
      if (event.button !== BACK_BUTTON || !history.canGoBack()) return;

      event.preventDefault();
      history.back();
    };

    window.addEventListener("mouseup", onMouseUp);

    return () => window.removeEventListener("mouseup", onMouseUp);
  }, [history]);
}
