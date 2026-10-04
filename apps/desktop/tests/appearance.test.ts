import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { FuglePlan } from "@solyx/market-data/fugle";

import { PriceColors, Theme } from "#shared/ipc/settings.ts";
import {
  ColorScheme,
  PALETTES,
  Palette,
  PaletteToken,
} from "#shared/palette.ts";

import { createAppearance } from "../src/main/modules/settings/appearance.ts";
import { createConfigFile } from "../src/main/modules/settings/config-file.ts";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-appearance-"));
});

afterEach(() => rm(directory, { recursive: true, force: true }));

function setup() {
  const file = join(directory, ".solyx", "config.jsonc");
  const config = createConfigFile(file);
  const onChange = vi.fn();

  config.create();

  const appearance = createAppearance({ config, onChange });

  return { file, config, appearance, onChange };
}

test("a copy takes the next free id, and a copy of a custom palette keeps its colours", () => {
  const { appearance } = setup();

  const first = appearance.copyPalette(Palette.Iris, "Mine");

  appearance.setPaletteColor(
    first,
    ColorScheme.Light,
    PaletteToken.Accent,
    "#aa3366"
  );

  const second = appearance.copyPalette(first, "Mine again");

  expect([first, second]).toEqual(["custom-1", "custom-2"]);
  expect(appearance.read().palettes[second]).toEqual({
    name: "Mine again",
    extends: Palette.Iris,
    [ColorScheme.Light]: { accent: "#aa3366" },
    [ColorScheme.Dark]: {},
  });
  expect(() => appearance.copyPalette("gone", "Nope")).toThrow(
    'No palette "gone"'
  );
});

test("a shown custom palette paints its colours over its base, and clearing one goes back to the base's", () => {
  const { appearance } = setup();
  const id = appearance.copyPalette(Palette.Iris, "Mine");
  const base = PALETTES[Palette.Iris][ColorScheme.Dark];

  appearance.setPalette(ColorScheme.Dark, id);
  appearance.setPaletteColor(
    id,
    ColorScheme.Dark,
    PaletteToken.Accent,
    "#123456"
  );

  expect(appearance.colors(ColorScheme.Dark)).toEqual({
    ...base,
    accent: "#123456",
  });

  appearance.setPaletteColor(id, ColorScheme.Dark, PaletteToken.Accent, null);

  expect(appearance.colors(ColorScheme.Dark)).toEqual(base);
});

test("deleting a palette a scheme shows shows the palette it was copied from there", () => {
  const { appearance } = setup();
  const id = appearance.copyPalette(Palette.Iris, "Mine");

  appearance.setPalette(ColorScheme.Light, id);
  appearance.setPalette(ColorScheme.Dark, Palette.Blueprint);
  appearance.deletePalette(id);

  expect(appearance.read().palette).toEqual({
    [ColorScheme.Light]: Palette.Iris,
    [ColorScheme.Dark]: Palette.Blueprint,
  });
  expect(appearance.read().palettes).toEqual({});
});

test("built-in and missing palettes cannot be edited, and only known palettes can be shown", () => {
  const { appearance } = setup();

  expect(() => appearance.renamePalette(Palette.Iris, "Mine")).toThrow(
    'No custom palette "iris"'
  );
  expect(() =>
    appearance.setPaletteColor(
      "gone",
      ColorScheme.Light,
      PaletteToken.Accent,
      "#000000"
    )
  ).toThrow('No custom palette "gone"');
  expect(() => appearance.deletePalette("gone")).toThrow(
    'No custom palette "gone"'
  );
  expect(() => appearance.setPalette(ColorScheme.Light, "gone")).toThrow(
    'No palette "gone"'
  );
});

test("each change is told once, and other settings are not", () => {
  const { config, appearance, onChange } = setup();

  appearance.setTheme(Theme.Dark);
  appearance.setTheme(Theme.Dark);
  config.set(["providers", "fugle", "plan"], FuglePlan.Developer);
  appearance.setPriceColors(PriceColors.GreenUp);

  expect(onChange.mock.calls.map(([told]) => told.theme)).toEqual([
    Theme.Dark,
    Theme.Dark,
  ]);
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ priceColors: PriceColors.GreenUp })
  );
});

test("a hand edit is told as a save here would be", async () => {
  const { file, config, onChange } = setup();
  const stop = config.watch();

  await writeFile(file, '{ "appearance": { "theme": "light" } }');
  await vi.waitFor(() =>
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ theme: Theme.Light })
    )
  );
  stop();
});
