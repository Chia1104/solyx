import { useId, useState } from "react";
import type { CSSProperties } from "react";

import { Button, Description, Disclosure, cn } from "@heroui/react";
import {
  Copy01Icon,
  Moon02Icon,
  PencilEdit02Icon,
  Sun03Icon,
} from "@hugeicons/core-free-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ToggleButton } from "react-aria-components";
import { useTranslation } from "react-i18next";

import type { Appearance } from "#shared/ipc/settings.ts";
import {
  ColorScheme,
  Palette,
  isCustomPalette,
  resolvePalette,
} from "#shared/palette.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { Icon } from "../../components/icon.tsx";

import { PaletteEditor } from "./palette-editor.tsx";
import { usePaletteName } from "./palette-name.ts";
import { appearanceQuery } from "./settings-query.ts";

const SCHEME_ICON = {
  [ColorScheme.Light]: Sun03Icon,
  [ColorScheme.Dark]: Moon02Icon,
};

/** The palette's ink washed over its paper, as one swatch. */
function swatchStyle(
  appearance: Appearance,
  palette: string,
  scheme: ColorScheme
): CSSProperties {
  const colors = resolvePalette(palette, appearance.palettes, scheme);

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
  palette: string;
}

/**
 * The palette picked for each scheme, unfolding into a card per palette, built-in ones first, with
 * a swatch per scheme; picking a swatch sets that scheme's palette. While `editable`, any palette
 * can be copied into one of the user's own, which they can edit; first-run setup only picks.
 */
export function PalettePicker({ editable = true }: { editable?: boolean }) {
  const { t } = useTranslation();
  const labelId = useId();
  const descriptionId = useId();
  const paletteName = usePaletteName();
  const { data } = useQuery(appearanceQuery());
  const [editing, setEditing] = useState<string | null>(null);

  // The main process pushes the saved appearance, which the query takes.
  const save = useMutation({
    mutationFn: ({ scheme, palette }: PaletteChoice) =>
      window.solyx.settings.setPalette(scheme, palette),
  });

  const copy = useMutation({
    mutationFn: (palette: string) =>
      window.solyx.settings.copyPalette(
        palette,
        t("settings.palette-copy-name", { name: paletteName(palette) })
      ),
    onSuccess: setEditing,
  });

  const palettes = data
    ? [...Object.values(Palette), ...Object.keys(data.palettes)]
    : [];

  const error = save.error ?? copy.error;

  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-sm font-medium">
        {t("settings.palette")}
      </span>
      {data ? (
        <Disclosure>
          <Disclosure.Heading>
            <Disclosure.Trigger className="flex w-full items-center gap-4 rounded border border-border bg-surface px-3 py-2 text-sm">
              {Object.values(ColorScheme).map((scheme) => (
                <span key={scheme} className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    style={swatchStyle(data, data.palette[scheme], scheme)}
                    className="size-5 shrink-0 rounded-full ring-1 ring-border"
                  />
                  <span className="shrink-0 text-muted">
                    {t(`settings.themes.${scheme}`)}
                  </span>
                  <span className="truncate">
                    {paletteName(data.palette[scheme])}
                  </span>
                </span>
              ))}
              <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted tabular-nums">
                {t("settings.palette-count", { count: palettes.length })}
                <Disclosure.Indicator />
              </span>
            </Disclosure.Trigger>
          </Disclosure.Heading>
          <Disclosure.Content>
            <div
              role="group"
              aria-labelledby={labelId}
              aria-describedby={descriptionId}
              className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3 pt-3">
              {palettes.map((palette) => {
                const name = paletteName(palette);

                return (
                  <div
                    key={palette}
                    className={cn(
                      "flex flex-col gap-2 rounded border border-border bg-surface p-4",
                      editable && "pb-2"
                    )}>
                    <div className="flex justify-center gap-4">
                      {Object.values(ColorScheme).map((scheme) => {
                        const icon = SCHEME_ICON[scheme];
                        const selected = data.palette[scheme] === palette;

                        return (
                          <ToggleButton
                            key={scheme}
                            aria-label={t("settings.palette-swatch", {
                              palette: name,
                              scheme: t(`settings.themes.${scheme}`),
                            })}
                            isSelected={selected}
                            isDisabled={save.isPending}
                            onChange={(next) => {
                              if (next) save.mutate({ scheme, palette });
                            }}
                            style={swatchStyle(data, palette, scheme)}
                            className="relative size-11 rounded-full ring-1 ring-border outline-none data-focus-visible:ring-2 data-focus-visible:ring-focus data-focus-visible:ring-offset-2 data-focus-visible:ring-offset-surface data-selected:ring-2 data-selected:ring-accent data-selected:ring-offset-2 data-selected:ring-offset-surface">
                            {selected ? (
                              <span className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full border border-border bg-surface text-foreground">
                                <Icon icon={icon} className="size-3" />
                              </span>
                            ) : null}
                          </ToggleButton>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-1">
                      <span
                        className={cn(
                          "min-w-0 grow truncate text-sm",
                          !editable && "text-center"
                        )}>
                        {name}
                      </span>
                      {editable && isCustomPalette(palette, data.palettes) ? (
                        <Button
                          isIconOnly
                          size="sm"
                          variant="ghost"
                          aria-label={t("settings.palette-edit", { name })}
                          aria-pressed={editing === palette}
                          className="text-muted"
                          onPress={() =>
                            setEditing(editing === palette ? null : palette)
                          }>
                          <Icon icon={PencilEdit02Icon} />
                        </Button>
                      ) : null}
                      {editable ? (
                        <Button
                          isIconOnly
                          size="sm"
                          variant="ghost"
                          aria-label={t("settings.palette-copy", { name })}
                          className="text-muted"
                          isDisabled={copy.isPending}
                          onPress={() => copy.mutate(palette)}>
                          <Icon icon={Copy01Icon} />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </Disclosure.Content>
        </Disclosure>
      ) : null}
      <Description id={descriptionId}>
        {t("settings.palette-description")}
      </Description>
      {error ? (
        <ErrorAlert
          title={t("settings.save-failed")}
          description={error.message}
        />
      ) : null}
      {data && editing && isCustomPalette(editing, data.palettes) ? (
        <PaletteEditor
          key={editing}
          id={editing}
          palette={data.palettes[editing]}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
