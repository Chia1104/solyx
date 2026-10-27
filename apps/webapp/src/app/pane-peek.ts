import { useEffect } from "react";

import { create } from "zustand";

import type { Pane } from "./layout-store.ts";
import { useLayoutStore } from "./layout-store.ts";

/** How long the pointer rests on a closed pane's edge or toggle before the pane shows over the page. */
export const PEEK_DELAY = 90;

/** How long a pane shown over the page stays once the pointer leaves it, so passing beside it keeps it. */
const LEAVE_GRACE = 240;

interface PeekState {
  /** The closed pane shown over the page, held in no storage. */
  pane: Pane | null;
}

interface PeekActions {
  /** Shows a closed pane over the page after `delay`, unless the pointer leaves first. */
  peek: (pane: Pane, delay: number) => void;
  /** Hides the pane shown after a grace, or cancels one about to show. */
  leave: () => void;
  /** Keeps the pane shown, cancelling a hide under way. */
  stay: () => void;
  dismiss: () => void;
}

let showing: ReturnType<typeof setTimeout> | undefined;

let hiding: ReturnType<typeof setTimeout> | undefined;

export const usePeekStore = create<PeekState & PeekActions>()((set, get) => ({
  pane: null,
  peek: (pane, delay) => {
    clearTimeout(hiding);
    hiding = undefined;
    clearTimeout(showing);

    if (get().pane !== pane) showing = setTimeout(() => set({ pane }), delay);
  },
  leave: () => {
    clearTimeout(showing);

    if (get().pane === null || hiding !== undefined) return;

    hiding = setTimeout(() => {
      hiding = undefined;
      set({ pane: null });
    }, LEAVE_GRACE);
  },
  stay: () => {
    clearTimeout(hiding);
    hiding = undefined;
  },
  dismiss: () => {
    clearTimeout(showing);
    clearTimeout(hiding);
    hiding = undefined;
    set({ pane: null });
  },
}));

// A pane opened is no longer shown over the page.
useLayoutStore.subscribe(({ panes }) => {
  const { pane, dismiss } = usePeekStore.getState();

  if (pane !== null && panes[pane].open) dismiss();
});

// Whether the pointer last moved onto the pane shown, or onto what it opened, such as a menu.
let pointerInside = false;

// Whether focus is in the pane shown, or in what it opened.
let focusInside = false;

// Focus keeps the pane only while it is typed into or moved by keyboard, so a click on a row
// leaves it to the pointer.
function focusHolds() {
  const active = document.activeElement;

  return (
    focusInside &&
    active instanceof HTMLElement &&
    (active.matches(":focus-visible") ||
      active.matches("input, textarea") ||
      active.isContentEditable)
  );
}

function settle() {
  const { pane, stay, leave } = usePeekStore.getState();

  if (pane === null) return;

  if (pointerInside || focusHolds()) stay();
  else leave();
}

/**
 * The handlers of a closed pane's content. React passes them events from the menus and
 * dialogs it opens too, since those are its children, so using one keeps the pane shown.
 */
export const peekSurface = {
  onPointerOver: () => {
    pointerInside = true;
  },
  onFocus: () => {
    focusInside = true;
  },
  // Focus moving within fires its focus right after, so the check waits for it.
  onBlur: () => {
    focusInside = false;
    setTimeout(settle);
  },
};

/**
 * Follows the pointer while a pane shows over the page: every element it moves onto first
 * counts as outside, then as inside where the pane's handlers claim it or it lies in the pane's
 * edge or toggle, which carry `data-peek` with the pane's name. A press outside, or Escape that
 * nothing else took, hides the pane at once, as either closes a menu.
 */
export function useFollowPeek() {
  const pane = usePeekStore((state) => state.pane);

  useEffect(() => {
    if (pane === null) return;

    // It shows only while the pointer rests on its edge or toggle.
    pointerInside = true;
    focusInside = false;

    const before = () => {
      pointerInside = false;
    };

    const after = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(`[data-peek="${pane}"]`)
      ) {
        pointerInside = true;
      }

      settle();
    };

    // A press lands where the pointer last moved, and capture sees it even where a chart stops it.
    const press = () => {
      if (!pointerInside) usePeekStore.getState().dismiss();
    };

    // A menu that handles Escape stops it before it bubbles here.
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        usePeekStore.getState().dismiss();
      }
    };

    // Capture runs before React hands the event to the pane, and bubbling after.
    document.addEventListener("pointerover", before, true);
    document.addEventListener("pointerover", after);
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("keydown", escape);

    return () => {
      document.removeEventListener("pointerover", before, true);
      document.removeEventListener("pointerover", after);
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("keydown", escape);
    };
  }, [pane]);
}
