import { useCallback, useSyncExternalStore } from "react";

import { QueryObserver, useSuspenseQuery } from "@tanstack/react-query";
import { kebabCase } from "es-toolkit";

import type { Appearance } from "#shared/ipc/settings.ts";
import { ColorScheme, resolvePalette } from "#shared/palette.ts";
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

const paletteSheet = new CSSStyleSheet();

let applied: Appearance | undefined;

function applyScheme() {
  const scheme = currentScheme();
  const root = document.documentElement;

  root.classList.toggle(ColorScheme.Dark, scheme === ColorScheme.Dark);
  root.classList.toggle(ColorScheme.Light, scheme === ColorScheme.Light);
  root.dataset.theme = scheme;

  // styles.css keeps the page clear until this is set, so the window's own background shows.
  if (applied) root.dataset.palette = applied.palette[scheme];
}

/** Writes each scheme's palette as the custom properties HeroUI and styles.css read. */
function applyPalettes(appearance: Appearance) {
  applied = appearance;

  paletteSheet.replaceSync(
    Object.values(ColorScheme)
      .map((scheme) => {
        const colors = resolvePalette(
          appearance.palette[scheme],
          appearance.palettes,
          scheme
        );

        const properties = Object.entries(colors)
          .map(([token, color]) => `--${kebabCase(token)}: ${color};`)
          .join(" ");

        return `${SCHEME_SELECTOR[scheme]} { ${properties} }`;
      })
      .join("\n")
  );

  applyScheme();
}

/**
 * Mirrors the appearance Electron forwards, which is the theme chosen in settings or else the
 * computer's, and the palettes and price colours the main process pushes. Resolves once the
 * saved palettes apply, so the first render already shows them.
 */
export async function followAppearance() {
  // Adopted sheets cascade after every sheet in the document, so the palette overrides HeroUI's
  // defaults whenever the bundle loads.
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, paletteSheet];

  applyScheme();
  darkScheme.addEventListener("change", applyScheme);

  window.solyx.settings.onAppearance((appearance) => {
    queryClient.setQueryData(settingsQueryKeys.appearance, appearance);
  });

  // Whatever the query holds shows, so a palette being edited shows before it is saved.
  new QueryObserver(queryClient, appearanceQuery()).subscribe(({ data }) => {
    if (data && data !== applied) applyPalettes(data);
  });

  applyPalettes(await queryClient.query(appearanceQuery()));
}

function subscribeToScheme(onChange: () => void) {
  darkScheme.addEventListener("change", onChange);

  return () => darkScheme.removeEventListener("change", onChange);
}

/** The scheme the window shows now. */
export function useColorScheme(): ColorScheme {
  return useSyncExternalStore(subscribeToScheme, currentScheme);
}

/** For canvas renderers, such as charts, that cannot read CSS custom properties. */
export function usePaletteColors(): PaletteColors {
  const scheme = useColorScheme();

  // A stable select runs again only when the appearance changes, so charts keep their options.
  const select = useCallback(
    (appearance: Appearance) =>
      resolvePalette(appearance.palette[scheme], appearance.palettes, scheme),
    [scheme]
  );

  return useSuspenseQuery({ ...appearanceQuery(), select }).data;
}
