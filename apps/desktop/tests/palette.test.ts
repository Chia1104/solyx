import { expect, test } from "vite-plus/test";

import {
  ColorScheme,
  PALETTES,
  Palette,
  hasPalette,
  isCustomPalette,
  resolvePalette,
} from "#shared/palette.ts";

const custom = {
  dusk: {
    name: "Dusk",
    extends: Palette.Iris,
    [ColorScheme.Light]: { accent: "#aa3366" },
    [ColorScheme.Dark]: {},
  },
};

test("a custom palette sets its own colours over its base and keeps the price pair", () => {
  const light = resolvePalette("dusk", custom, ColorScheme.Light);
  const base = PALETTES[Palette.Iris][ColorScheme.Light];

  expect(light).toEqual({ ...base, accent: "#aa3366" });
  expect(light.quoteRed).toBe(base.quoteRed);
  expect(resolvePalette("dusk", custom, ColorScheme.Dark)).toEqual(
    PALETTES[Palette.Iris][ColorScheme.Dark]
  );
});

test("an id that names no palette reads as the default one", () => {
  expect(resolvePalette("gone", custom, ColorScheme.Dark)).toBe(
    PALETTES[Palette.Blueprint][ColorScheme.Dark]
  );
  expect(resolvePalette("constructor", custom, ColorScheme.Dark)).toBe(
    PALETTES[Palette.Blueprint][ColorScheme.Dark]
  );
});

test("only the user's own palettes are custom", () => {
  expect(hasPalette(Palette.Sepia, custom)).toBe(true);
  expect(hasPalette("dusk", custom)).toBe(true);
  expect(hasPalette("toString", custom)).toBe(false);
  expect(isCustomPalette("dusk", custom)).toBe(true);
  expect(isCustomPalette(Palette.Sepia, custom)).toBe(false);
});
