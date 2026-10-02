import { useSyncExternalStore } from "react";

import { kebabCase } from "es-toolkit";

import { ColorScheme, PALETTE } from "#shared/palette.ts";
import type { PaletteColors } from "#shared/palette.ts";

import {
  appearanceQuery,
  settingsQueryKeys,
} from "../modules/settings/settings-query.ts";

import { queryClient } from "./query-client.ts";

const darkScheme = window.matchMedia("(prefers-color-scheme: dark)");

const currentScheme = (): ColorScheme =>
  darkScheme.matches ? ColorScheme.Dark : ColorScheme.Light;

// HeroUI switches palettes by these selectors; the light one also sits on :root, so it applies first.
const SCHEME_SELECTOR: Record<ColorScheme, string> = {
  [ColorScheme.Light]: ':root, .light, [data-theme="light"]',
  [ColorScheme.Dark]: '.dark, [data-theme="dark"]',
};

/**
 * Writes the palette as the custom properties HeroUI and styles.css read. Adopted sheets cascade
 * after every sheet in the document, so it overrides HeroUI's defaults whenever the bundle loads.
 */
function applyPalette() {
  const sheet = new CSSStyleSheet();

  sheet.replaceSync(
    Object.values(ColorScheme)
      .map((scheme) => {
        const properties = Object.entries(PALETTE[scheme])
          .map(([token, color]) => `--${kebabCase(token)}: ${color};`)
          .join(" ");

        return `${SCHEME_SELECTOR[scheme]} { ${properties} }`;
      })
      .join("\n")
  );

  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}

function applyScheme() {
  const scheme = currentScheme();

  document.documentElement.classList.toggle(
    ColorScheme.Dark,
    scheme === ColorScheme.Dark
  );
  document.documentElement.classList.toggle(
    ColorScheme.Light,
    scheme === ColorScheme.Light
  );
  document.documentElement.dataset.theme = scheme;
}

/**
 * Mirrors the appearance Electron forwards, which is the theme chosen in settings or else the
 * computer's, and keeps the appearance query in step with what the main process pushes.
 */
export function followAppearance() {
  applyPalette();
  applyScheme();
  darkScheme.addEventListener("change", applyScheme);

  window.solyx.settings.onAppearance((appearance) => {
    queryClient.setQueryData(settingsQueryKeys.appearance, appearance);
  });

  void queryClient.prefetchQuery(appearanceQuery());
}

function subscribeToScheme(onChange: () => void) {
  darkScheme.addEventListener("change", onChange);

  return () => darkScheme.removeEventListener("change", onChange);
}

/** For canvas renderers, such as charts, that cannot read CSS custom properties. */
export function usePaletteColors(): PaletteColors {
  return PALETTE[useSyncExternalStore(subscribeToScheme, currentScheme)];
}
