import { useMatchRoute } from "@tanstack/react-router";
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
