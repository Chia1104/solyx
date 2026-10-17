import { useSyncExternalStore } from "react";

/**
 * The sheet's colours, read from the stylesheet's custom properties for what paints outside CSS:
 * the canvases and the demo's chart.
 */
export interface SheetColors {
  card: string;
  foreground: string;
  mutedForeground: string;
  border: string;
  primary: string;
  primaryForeground: string;
  primaryDeep: string;
  primaryLight: string;
  graphite: string;
  candleRise: string;
  candleFall: string;
}

let cached: { key: string; colors: SheetColors } | null = null;

// useSyncExternalStore compares snapshots by identity, so an unchanged theme returns the same object.
function read(): SheetColors {
  const style = getComputedStyle(document.documentElement);
  const value = (property: string) => style.getPropertyValue(property).trim();

  const colors: SheetColors = {
    card: value("--card"),
    foreground: value("--foreground"),
    mutedForeground: value("--muted-foreground"),
    border: value("--border"),
    primary: value("--primary"),
    primaryForeground: value("--primary-foreground"),
    primaryDeep: value("--primary-deep"),
    primaryLight: value("--primary-light"),
    graphite: value("--graphite"),
    candleRise: value("--candle-rise"),
    candleFall: value("--candle-fall"),
  };

  const key = Object.values(colors).join();

  if (cached?.key !== key) cached = { key, colors };

  return cached.colors;
}

// The theme switches by a class on the root element, which swaps the custom properties.
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"],
  });

  return () => observer.disconnect();
}

/** The sheet's colours for the current theme; `null` while rendering on the server. */
export function useSheetColors(): SheetColors | null {
  return useSyncExternalStore(subscribe, read, () => null);
}
