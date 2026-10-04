import { isEqual } from "es-toolkit";

import { isEnumValue } from "@solyx/utils/is";

import type { Appearance, PriceColors, Theme } from "#shared/ipc/settings.ts";
import {
  ColorScheme,
  Palette,
  hasPalette,
  isCustomPalette,
  resolvePalette,
} from "#shared/palette.ts";
import type {
  CustomPalette,
  PaletteColors,
  PaletteToken,
} from "#shared/palette.ts";

import type { ConfigEntry, ConfigFile } from "./config-file.ts";

interface AppearanceOptions {
  config: ConfigFile;
  /** The appearance changed, saved here or by hand in the config file; called once per change. */
  onChange: (appearance: Appearance) => void;
}

/** The theme, the palettes each scheme shows and the price colours, with the rules for the user's own palettes. */
export function createAppearance({ config, onChange }: AppearanceOptions) {
  const read = (): Appearance => config.read().appearance;

  let shown = read();

  config.onChange(() => {
    const next = read();

    if (isEqual(next, shown)) return;

    shown = next;
    onChange(next);
  });

  /** The custom palette `id`, or an error for one that is built in or gone. */
  function customPalette(id: string): CustomPalette {
    const { palettes } = read();

    if (!isCustomPalette(id, palettes)) {
      throw new Error(`No custom palette "${id}"`);
    }

    return palettes[id];
  }

  return {
    read,

    colors(scheme: ColorScheme): PaletteColors {
      const { palette, palettes } = read();

      return resolvePalette(palette[scheme], palettes, scheme);
    },

    setTheme(theme: Theme) {
      config.set(["appearance", "theme"], theme);
    },

    setPalette(scheme: ColorScheme, palette: string) {
      if (!hasPalette(palette, read().palettes)) {
        throw new Error(`No palette "${palette}"`);
      }

      config.set(["appearance", "palette", scheme], palette);
    },

    /**
     * Saves a copy of `source` under the first free `custom-n` id and returns it. A copy of a
     * built-in palette sets nothing over it; a copy of a custom one keeps its colours.
     */
    copyPalette(source: string, name: string): string {
      const { palettes } = read();

      const copy: CustomPalette | undefined = isCustomPalette(source, palettes)
        ? { ...palettes[source], name }
        : isEnumValue(Palette, source)
          ? { name, extends: source, light: {}, dark: {} }
          : undefined;

      if (!copy) throw new Error(`No palette "${source}"`);

      let number = 1;

      while (Object.hasOwn(palettes, `custom-${number}`)) number += 1;

      const id = `custom-${number}`;

      config.set(["appearance", "palettes", id], copy);

      return id;
    },

    renamePalette(palette: string, name: string) {
      customPalette(palette);
      config.set(["appearance", "palettes", palette, "name"], name);
    },

    /** `null` goes back to the base palette's colour. */
    setPaletteColor(
      palette: string,
      scheme: ColorScheme,
      token: PaletteToken,
      color: string | null
    ) {
      customPalette(palette);
      config.set(
        ["appearance", "palettes", palette, scheme, token],
        color ?? undefined
      );
    },

    /** A scheme that showed it goes back to the palette it was copied from. */
    deletePalette(palette: string) {
      const { extends: base } = customPalette(palette);
      const showing = read().palette;

      config.update([
        [["appearance", "palettes", palette], undefined],
        ...Object.values(ColorScheme)
          .filter((scheme) => showing[scheme] === palette)
          .map((scheme): ConfigEntry => [
            ["appearance", "palette", scheme],
            base,
          ]),
      ]);
    },

    setPriceColors(priceColors: PriceColors) {
      config.set(["appearance", "priceColors"], priceColors);
    },
  };
}
