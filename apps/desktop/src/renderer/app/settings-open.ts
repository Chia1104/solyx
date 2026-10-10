import { useEffect, useRef } from "react";

import { useLocation, useMatchRoute } from "@tanstack/react-router";
import type { RegisteredRouter } from "@tanstack/react-router";

import { Pane } from "./layout-store.ts";

const SETTINGS_PATH =
  "/settings" satisfies keyof RegisteredRouter["routesByPath"];

export function useSettingsOpen() {
  const matchRoute = useMatchRoute();

  return matchRoute({ to: SETTINGS_PATH }) !== false;
}

/**
 * The pane that shows whatever its toggle says: the symbols pane while it lists the settings
 * page's sections, which are reached nowhere else.
 */
export function useHeldPane(): Pane | undefined {
  return useSettingsOpen() ? Pane.Symbols : undefined;
}

/**
 * The address of the last page open that was not settings, where leaving settings returns. Pages
 * are followed only while the caller is mounted, so it has to outlive the settings page.
 */
export function useLastPage() {
  // Read off the location alone: a route match trails it while a page loads, and the two would disagree.
  const page = useLocation({
    select: ({ pathname, href }) =>
      pathname === SETTINGS_PATH ? undefined : href,
  });

  const lastPage = useRef("/");

  useEffect(() => {
    if (page !== undefined) lastPage.current = page;
  }, [page]);

  return lastPage;
}
