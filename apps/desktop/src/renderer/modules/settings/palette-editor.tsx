import { useId, useMemo, useState } from "react";

import {
  AlertDialog,
  Button,
  ColorArea,
  ColorField,
  ColorPicker,
  ColorSlider,
  ColorSwatch,
  FieldError,
  Form,
  Input,
  Label,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  parseColor,
} from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Color } from "react-aria-components";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { isEnumValue } from "@solyx/utils/is";

import type { Appearance } from "#shared/ipc/settings.ts";
import { ColorScheme, PALETTES, PaletteToken } from "#shared/palette.ts";
import type { CustomPalette, PaletteColors } from "#shared/palette.ts";

import { useColorScheme } from "../../app/theme.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";

import { usePaletteName } from "./palette-name.ts";
import { settingsQueryKeys } from "./settings-query.ts";

const TokenGroup = {
  Paper: "paper",
  Ink: "ink",
  Lines: "lines",
  Accent: "accent",
} as const;

type TokenGroup = (typeof TokenGroup)[keyof typeof TokenGroup];

const GROUP_TOKENS: Record<TokenGroup, PaletteToken[]> = {
  [TokenGroup.Paper]: [
    PaletteToken.Background,
    PaletteToken.Surface,
    PaletteToken.SurfaceSecondary,
    PaletteToken.SurfaceTertiary,
    PaletteToken.Overlay,
    PaletteToken.FieldBackground,
    PaletteToken.Segment,
    PaletteToken.Default,
  ],
  [TokenGroup.Ink]: [PaletteToken.Foreground, PaletteToken.Muted],
  [TokenGroup.Lines]: [PaletteToken.Separator, PaletteToken.Border],
  [TokenGroup.Accent]: [PaletteToken.Accent, PaletteToken.AccentForeground],
};

// Lower case, as the main process saves it, so a preview and its save read the same.
const hex = (color: Color) => color.toString("hex").toLowerCase();

/** The palette's paper, ink, accent and price pair, drawn as a small panel. */
function PalettePreview({ colors }: { colors: PaletteColors }) {
  const { t, i18n } = useTranslation();

  const percent = new Intl.NumberFormat(i18n.language, {
    style: "percent",
    signDisplay: "always",
    minimumFractionDigits: 2,
  });

  return (
    <div
      aria-hidden
      className="rounded border p-3"
      style={{ background: colors.background, borderColor: colors.border }}>
      <div
        className="flex flex-col gap-2 rounded border p-3"
        style={{
          background: colors.surface,
          borderColor: colors.separator,
          color: colors.foreground,
        }}>
        <p className="text-sm font-medium">
          {t("settings.palette-editor.preview-title")}
        </p>
        <p className="text-xs" style={{ color: colors.muted }}>
          {t("settings.palette-editor.preview-body")}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className="rounded px-2 py-1 font-medium"
            style={{
              background: colors.accent,
              color: colors.accentForeground,
            }}>
            {t("settings.palette-editor.preview-action")}
          </span>
          <span
            className="rounded px-2 py-1"
            style={{ background: colors.default }}>
            {t("common.cancel")}
          </span>
          <span className="tabular-nums" style={{ color: colors.quoteRed }}>
            {percent.format(0.0125)}
          </span>
          <span className="tabular-nums" style={{ color: colors.quoteGreen }}>
            {percent.format(-0.008)}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * One colour with a picker. Dragging shows the colour through `onPreview`; letting go, or
 * entering a hex value, saves it through `onSave`.
 */
function PaletteColorRow({
  token,
  color,
  changed,
  onPreview,
  onSave,
}: {
  token: PaletteToken;
  color: string;
  /** Set over the base palette, so it can go back. */
  changed: boolean;
  onPreview: (color: string) => void;
  onSave: (color: string | null) => void;
}) {
  const { t } = useTranslation();
  const label = t(`settings.palette-tokens.${token}`);

  // Kept while dragging, since hex rounding would move the thumbs; the saved colour takes over after.
  const [draft, setDraft] = useState<Color | null>(null);

  const commit = (next: Color) => {
    setDraft(null);
    onSave(hex(next));
  };

  return (
    <div className="flex items-center gap-2">
      <ColorPicker
        value={draft ?? parseColor(color)}
        onChange={(next) => {
          setDraft(next);
          onPreview(hex(next));
        }}>
        <ColorPicker.Trigger className="flex min-w-0 grow items-center gap-2">
          <ColorSwatch size="sm" />
          <span className="truncate text-sm">{label}</span>
        </ColorPicker.Trigger>
        <ColorPicker.Popover className="gap-2">
          <ColorArea
            aria-label={t("settings.palette-editor.area", { token: label })}
            className="max-w-full"
            colorSpace="hsb"
            xChannel="saturation"
            yChannel="brightness"
            onChangeEnd={commit}>
            <ColorArea.Thumb />
          </ColorArea>
          <ColorSlider
            aria-label={t("settings.palette-editor.hue", { token: label })}
            channel="hue"
            colorSpace="hsb"
            className="px-1"
            onChangeEnd={commit}>
            <ColorSlider.Track>
              <ColorSlider.Thumb />
            </ColorSlider.Track>
          </ColorSlider>
          <ColorField
            aria-label={t("settings.palette-editor.hex", { token: label })}
            onChange={(next) => {
              if (next) commit(next);
            }}>
            <ColorField.Group variant="secondary">
              <ColorField.Input />
            </ColorField.Group>
          </ColorField>
        </ColorPicker.Popover>
      </ColorPicker>
      <span className="font-mono text-xs text-muted">{color}</span>
      {changed ? (
        <Button
          size="sm"
          variant="ghost"
          aria-label={t("settings.palette-editor.reset-named", {
            token: label,
          })}
          onPress={() => onSave(null)}>
          {t("settings.palette-editor.reset")}
        </Button>
      ) : null}
    </div>
  );
}

/** The palette's name, saved when the field loses focus or on Enter. */
function PaletteNameField({ id, name }: { id: string; name: string }) {
  const { t } = useTranslation();

  const schema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(1, { error: t("settings.palette-editor.name-required") })
          .max(60),
      }),
    [t]
  );

  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { name },
  });

  const rename = useMutation({
    mutationFn: (next: string) => window.solyx.settings.renamePalette(id, next),
  });

  const submit = form.handleSubmit(({ name: next }) => {
    if (next !== name) rename.mutate(next);
  });

  return (
    <Form
      validationBehavior="aria"
      className="flex max-w-80 flex-col gap-2"
      onSubmit={(event) => void submit(event)}>
      <Controller
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <TextField isRequired isInvalid={fieldState.invalid}>
            <Label>{t("settings.palette-editor.name")}</Label>
            <Input
              {...field}
              onBlur={() => {
                field.onBlur();
                void submit();
              }}
            />
            <FieldError>{fieldState.error?.message}</FieldError>
          </TextField>
        )}
      />
      {rename.error ? (
        <ErrorAlert
          title={t("settings.save-failed")}
          description={rename.error.message}
        />
      ) : null}
    </Form>
  );
}

/** Deletes the palette after a confirmation; schemes that showed it go back to its base. */
function DeletePalette({
  id,
  name,
  base,
}: {
  id: string;
  name: string;
  base: string;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);

  const remove = useMutation({
    mutationFn: () => window.solyx.settings.deletePalette(id),
  });

  return (
    <AlertDialog isOpen={confirming} onOpenChange={setConfirming}>
      <Button size="sm" variant="danger-soft">
        {t("settings.palette-editor.delete")}
      </Button>
      <AlertDialog.Backdrop>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-100">
            <AlertDialog.Header>
              <AlertDialog.Heading>
                {t("settings.palette-editor.delete-title", { name })}
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="flex flex-col gap-3">
              <p>{t("settings.palette-editor.delete-body", { base })}</p>
              {remove.error ? (
                <ErrorAlert
                  title={t("settings.save-failed")}
                  description={remove.error.message}
                />
              ) : null}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                {t("common.cancel")}
              </Button>
              <Button
                variant="danger"
                isPending={remove.isPending}
                onPress={() => remove.mutate()}>
                {t("settings.palette-editor.delete-confirm")}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}

/**
 * Edits one of the user's palettes a scheme at a time. Each colour shows across the app while it
 * is picked, if the palette is showing, and saves once it settles.
 */
export function PaletteEditor({
  id,
  palette,
  onClose,
}: {
  id: string;
  palette: CustomPalette;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const headingId = useId();
  const schemeLabelId = useId();
  const paletteName = usePaletteName();
  const showing = useColorScheme();
  const [scheme, setScheme] = useState<ColorScheme>(showing);

  const name = paletteName(id);
  const changes = palette[scheme];
  const colors = { ...PALETTES[palette.extends][scheme], ...changes };

  // A failed save leaves the preview standing, so the query goes back to what is saved.
  const save = useMutation({
    mutationFn: ({
      token,
      color,
    }: {
      token: PaletteToken;
      color: string | null;
    }) => window.solyx.settings.setPaletteColor(id, scheme, token, color),
    onError: () =>
      queryClient.invalidateQueries({ queryKey: settingsQueryKeys.appearance }),
  });

  const preview = (token: PaletteToken, color: string) =>
    queryClient.setQueryData<Appearance>(
      settingsQueryKeys.appearance,
      (appearance) =>
        appearance && {
          ...appearance,
          palettes: {
            ...appearance.palettes,
            [id]: {
              ...palette,
              [scheme]: { ...changes, [token]: color },
            },
          },
        }
    );

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 id={headingId} className="text-sm font-medium">
          {t("settings.palette-editor.title", { name })}
        </h3>
        <Button size="sm" variant="tertiary" onPress={onClose}>
          {t("settings.palette-editor.done")}
        </Button>
      </div>
      <PaletteNameField id={id} name={name} />
      <p className="text-xs text-muted">
        {t("settings.palette-editor.based-on", {
          name: paletteName(palette.extends),
        })}
      </p>
      <div className="flex flex-col gap-2">
        <span id={schemeLabelId} className="text-sm font-medium">
          {t("settings.palette-editor.scheme")}
        </span>
        <ToggleButtonGroup
          aria-labelledby={schemeLabelId}
          selectionMode="single"
          disallowEmptySelection
          size="sm"
          selectedKeys={[scheme]}
          onSelectionChange={(keys) => {
            const [next] = keys;

            if (next !== undefined && isEnumValue(ColorScheme, next))
              setScheme(next);
          }}>
          {Object.values(ColorScheme).map((option) => (
            <ToggleButton key={option} id={option}>
              {t(`settings.themes.${option}`)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </div>
      <PalettePreview colors={colors} />
      {Object.values(TokenGroup).map((group) => (
        <fieldset key={group} className="flex flex-col gap-2">
          <legend className="mb-2 text-xs font-medium text-muted">
            {t(`settings.palette-editor.groups.${group}`)}
          </legend>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-x-6 gap-y-2">
            {GROUP_TOKENS[group].map((token) => (
              <PaletteColorRow
                key={`${scheme}:${token}`}
                token={token}
                color={colors[token]}
                changed={changes[token] !== undefined}
                onPreview={(color) => preview(token, color)}
                onSave={(color) => save.mutate({ token, color })}
              />
            ))}
          </div>
        </fieldset>
      ))}
      {save.error ? (
        <ErrorAlert
          title={t("settings.save-failed")}
          description={save.error.message}
        />
      ) : null}
      <div>
        <DeletePalette
          id={id}
          name={name}
          base={paletteName(palette.extends)}
        />
      </div>
    </section>
  );
}
