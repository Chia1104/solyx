import { useId } from "react";
import type { CSSProperties } from "react";

import { Description } from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ToggleButton } from "react-aria-components";
import { useTranslation } from "react-i18next";

import { ColorScheme, PALETTES, Palette } from "#shared/palette.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { MoonIcon, SunIcon } from "../../components/icons.tsx";

import { appearanceQuery } from "./settings-query.ts";

const SCHEME_ICON = {
  [ColorScheme.Light]: SunIcon,
  [ColorScheme.Dark]: MoonIcon,
};

/** The palette's ink washed over its paper, as one swatch. */
function swatchStyle(palette: Palette, scheme: ColorScheme): CSSProperties {
  const colors = PALETTES[palette][scheme];

  return {
    background: [
      `radial-gradient(circle at 70% 28%, ${colors.accent}, transparent 68%)`,
      `radial-gradient(circle at 28% 78%, ${colors.surfaceTertiary}, transparent 72%)`,
      colors.background,
    ].join(", "),
  };
}

interface PaletteChoice {
  scheme: ColorScheme;
  palette: Palette;
}

/** A card per palette with a swatch per scheme; picking a swatch sets that scheme's palette. */
export function PalettePicker() {
  const { t } = useTranslation();
  const labelId = useId();
  const descriptionId = useId();
  const { data } = useQuery(appearanceQuery());

  // The main process pushes the saved appearance, which the query takes.
  const save = useMutation({
    mutationFn: ({ scheme, palette }: PaletteChoice) =>
      window.solyx.settings.setPalette(scheme, palette),
  });

  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-sm font-medium">
        {t("settings.palette")}
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">
        {Object.values(Palette).map((palette) => (
          <div
            key={palette}
            className="flex flex-col gap-3 rounded border border-border bg-surface p-4">
            <div className="flex justify-center gap-4">
              {Object.values(ColorScheme).map((scheme) => {
                const Icon = SCHEME_ICON[scheme];
                const selected = data?.palette[scheme] === palette;

                return (
                  <ToggleButton
                    key={scheme}
                    aria-label={t("settings.palette-swatch", {
                      palette: t(`settings.palettes.${palette}`),
                      scheme: t(`settings.themes.${scheme}`),
                    })}
                    isSelected={selected}
                    isDisabled={!data || save.isPending}
                    onChange={(next) => {
                      if (next) save.mutate({ scheme, palette });
                    }}
                    style={swatchStyle(palette, scheme)}
                    className="relative size-11 rounded-full ring-1 ring-border outline-none data-focus-visible:ring-2 data-focus-visible:ring-focus data-focus-visible:ring-offset-2 data-focus-visible:ring-offset-surface data-selected:ring-2 data-selected:ring-accent data-selected:ring-offset-2 data-selected:ring-offset-surface">
                    {selected ? (
                      <span className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full border border-border bg-surface text-foreground">
                        <Icon className="size-3" />
                      </span>
                    ) : null}
                  </ToggleButton>
                );
              })}
            </div>
            <span className="text-sm">{t(`settings.palettes.${palette}`)}</span>
          </div>
        ))}
      </div>
      <Description id={descriptionId}>
        {t("settings.palette-description")}
      </Description>
      {save.error ? (
        <ErrorAlert
          title={t("settings.save-failed")}
          description={save.error.message}
        />
      ) : null}
    </div>
  );
}
