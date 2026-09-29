import { useSyncExternalStore } from "react";

const darkScheme = window.matchMedia("(prefers-color-scheme: dark)");

function applySystemTheme() {
  const theme = darkScheme.matches ? "dark" : "light";

  document.documentElement.classList.toggle("dark", darkScheme.matches);
  document.documentElement.classList.toggle("light", !darkScheme.matches);
  document.documentElement.dataset.theme = theme;
}

/** HeroUI switches palettes by class, so mirror the OS appearance that Electron forwards. */
export function followSystemTheme() {
  applySystemTheme();
  darkScheme.addEventListener("change", applySystemTheme);
}

function subscribeToScheme(onChange: () => void) {
  darkScheme.addEventListener("change", onChange);

  return () => darkScheme.removeEventListener("change", onChange);
}

/** For canvas renderers, such as charts, that cannot read HeroUI's CSS variables. */
export function useIsDarkTheme() {
  return useSyncExternalStore(subscribeToScheme, () => darkScheme.matches);
}
