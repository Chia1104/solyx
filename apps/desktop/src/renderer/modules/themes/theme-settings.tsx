import { useMemo, useState } from "react";

import {
  Button,
  Description,
  FieldError,
  Form,
  Input,
  Label,
  TextArea,
  TextField,
} from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { Market } from "@solyx/core/market";
import { holdsSecret } from "@solyx/core/memory";
import {
  THEME_EXPOSURE_LENGTH,
  THEME_LISTINGS,
  THEME_QUERIES,
  THEME_QUERY_LENGTH,
  THEME_SIGNPOSTS,
  THEME_SIGNPOST_LENGTH,
  THEME_THESIS_LENGTH,
  THEME_TITLE_LENGTH,
} from "@solyx/core/theme";
import type { ThemeDraft, ThemeWatch } from "@solyx/core/theme";
import { isEnumValue } from "@solyx/utils/is";

import { useClock } from "../../app/clock.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { Section } from "../../components/section.tsx";
import { RailedColumn } from "../../components/sheet.tsx";
import { SettingsList, SettingsRow } from "../settings/settings-list.tsx";

import { themesQuery } from "./themes-query.ts";

// A listing as a line of the form: its market and code, then how the theme would reach it.
const LISTING_LINE = /^(\w+)\s+(\S+)\s*[:：]\s*(.+)$/;

const linesOf = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

/** The listing a line names, or `undefined` for one that names no market the app trades. */
function listingOf(line: string) {
  const [, market, symbol, exposure] = LISTING_LINE.exec(line) ?? [];
  const named = market?.toUpperCase();

  return named !== undefined && isEnumValue(Market, named)
    ? { symbol: { market: named, symbol: symbol.toUpperCase() }, exposure }
    : undefined;
}

/** A theme as its form holds it, lists a line each; rebuilt per language so field errors come out localized. */
function useThemeFormSchema() {
  const { t } = useTranslation();

  return useMemo(() => {
    const text = (max: number) =>
      z
        .string()
        .trim()
        .min(1, { error: t("settings.theme-watch.required") })
        .max(max, { error: t("settings.theme-watch.too-long", { count: max }) })
        .refine((value) => !holdsSecret(value), {
          error: t("settings.theme-watch.secret"),
        });

    /** A list written a line each: at most `most` lines of at most `length` characters. */
    const lines = (most: number, length: number) =>
      z
        .string()
        .refine((value) => linesOf(value).length <= most, {
          error: t("settings.theme-watch.too-many", { count: most }),
        })
        .refine(
          (value) => linesOf(value).every((line) => line.length <= length),
          { error: t("settings.theme-watch.line-too-long", { count: length }) }
        )
        .refine((value) => !holdsSecret(value), {
          error: t("settings.theme-watch.secret"),
        });

    const some = (most: number, length: number) =>
      lines(most, length).refine((value) => linesOf(value).length > 0, {
        error: t("settings.theme-watch.required"),
      });

    return z.object({
      title: text(THEME_TITLE_LENGTH),
      thesis: text(THEME_THESIS_LENGTH),
      queries: some(THEME_QUERIES, THEME_QUERY_LENGTH),
      signposts: some(THEME_SIGNPOSTS, THEME_SIGNPOST_LENGTH),
      listings: lines(
        THEME_LISTINGS,
        THEME_EXPOSURE_LENGTH + THEME_QUERY_LENGTH
      ).refine(
        (value) =>
          linesOf(value).every((line) => listingOf(line) !== undefined),
        { error: t("settings.theme-watch.listing-format") }
      ),
    });
  }, [t]);
}

type ThemeForm = z.infer<ReturnType<typeof useThemeFormSchema>>;

const NEW_THEME: ThemeForm = {
  title: "",
  thesis: "",
  queries: "",
  signposts: "",
  listings: "",
};

const formOf = (theme: ThemeDraft): ThemeForm => ({
  title: theme.title,
  thesis: theme.thesis,
  queries: theme.queries.join("\n"),
  signposts: theme.signposts.join("\n"),
  listings: theme.listings
    .map(
      ({ symbol, exposure }) => `${symbol.market} ${symbol.symbol}: ${exposure}`
    )
    .join("\n"),
});

const draftOf = (form: ThemeForm): ThemeDraft => ({
  title: form.title,
  thesis: form.thesis,
  queries: linesOf(form.queries),
  signposts: linesOf(form.signposts),
  listings: linesOf(form.listings).flatMap((line) => listingOf(line) ?? []),
});

/** Writes a theme, new or kept: what is watched, why, what to search for and what would show it coming closer. */
function ThemeEditor({
  watch,
  onDone,
}: {
  /** The theme being edited; none for a new one. */
  watch?: ThemeWatch;
  onDone: () => void;
}) {
  const { t } = useTranslation();

  const form = useForm({
    resolver: zodResolver(useThemeFormSchema()),
    reValidateMode: "onSubmit",
    defaultValues: watch ? formOf(watch.theme) : NEW_THEME,
  });

  const save = useMutation({
    mutationFn: (values: ThemeForm) =>
      watch
        ? window.solyx.themes.update(watch.theme.id, draftOf(values))
        : window.solyx.themes.create(draftOf(values)),
    onSuccess: onDone,
  });

  const remove = useMutation({
    mutationFn: (id: string) => window.solyx.themes.remove(id),
    onSuccess: onDone,
  });

  const submit = form.handleSubmit((values) => save.mutate(values));
  const pending = save.isPending || remove.isPending;
  const error = save.error ?? remove.error;

  return (
    <Form
      validationBehavior="aria"
      className="flex flex-col gap-3"
      onSubmit={(event) => void submit(event)}>
      <Controller
        control={form.control}
        name="title"
        render={({ field, fieldState }) => (
          <TextField isRequired autoFocus isInvalid={fieldState.invalid}>
            <Label>{t("settings.theme-watch.name")}</Label>
            <Input {...field} autoComplete="off" />
            <FieldError>{fieldState.error?.message}</FieldError>
          </TextField>
        )}
      />
      <Controller
        control={form.control}
        name="thesis"
        render={({ field, fieldState }) => (
          <TextField isRequired isInvalid={fieldState.invalid}>
            <Label>{t("settings.theme-watch.thesis")}</Label>
            <TextArea {...field} rows={3} />
            <FieldError>{fieldState.error?.message}</FieldError>
          </TextField>
        )}
      />
      <Controller
        control={form.control}
        name="queries"
        render={({ field, fieldState }) => (
          <TextField isRequired isInvalid={fieldState.invalid}>
            <Label>{t("settings.theme-watch.queries")}</Label>
            <TextArea {...field} rows={2} />
            <Description>
              {t("settings.theme-watch.queries-description", {
                count: THEME_QUERIES,
              })}
            </Description>
            <FieldError>{fieldState.error?.message}</FieldError>
          </TextField>
        )}
      />
      <Controller
        control={form.control}
        name="signposts"
        render={({ field, fieldState }) => (
          <TextField isRequired isInvalid={fieldState.invalid}>
            <Label>{t("settings.theme-watch.signposts")}</Label>
            <TextArea {...field} rows={3} />
            <Description>
              {t("settings.theme-watch.signposts-description", {
                count: THEME_SIGNPOSTS,
              })}
            </Description>
            <FieldError>{fieldState.error?.message}</FieldError>
          </TextField>
        )}
      />
      <Controller
        control={form.control}
        name="listings"
        render={({ field, fieldState }) => (
          <TextField isInvalid={fieldState.invalid}>
            <Label>{t("settings.theme-watch.listings")}</Label>
            <TextArea {...field} rows={2} />
            <Description>
              {t("settings.theme-watch.listings-description")}
            </Description>
            <FieldError>{fieldState.error?.message}</FieldError>
          </TextField>
        )}
      />
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" isPending={save.isPending}>
          {t("settings.save")}
        </Button>
        <Button variant="tertiary" isDisabled={pending} onPress={onDone}>
          {t("common.cancel")}
        </Button>
        {watch ? (
          <Button
            variant="tertiary"
            className="ml-auto"
            isPending={remove.isPending}
            isDisabled={save.isPending}
            onPress={() => remove.mutate(watch.theme.id)}>
            {t("settings.theme-watch.delete")}
          </Button>
        ) : null}
      </div>
      {error ? (
        <ErrorAlert
          title={t("settings.theme-watch.change-failed")}
          description={error.message}
        />
      ) : null}
    </Form>
  );
}

/** One theme: what it watches, when it was last searched and what that found, edited below the row. */
function ThemeSettingsRow({ watch }: { watch: ThemeWatch }) {
  const { t } = useTranslation();
  const clock = useClock();
  const [editing, setEditing] = useState(false);
  const { theme, developments, latest, collectedAt } = watch;

  const check = useMutation({
    mutationFn: () => window.solyx.themes.check(theme.id),
  });

  return (
    <SettingsRow
      label={theme.title}
      description={
        <span className="flex flex-wrap gap-x-2 tabular-nums">
          <span>
            {collectedAt === null
              ? t("themes.not-searched")
              : t("themes.searched", { time: clock.time(collectedAt) })}
          </span>
          <span>
            · {t("settings.theme-watch.found", { count: latest.length })}
          </span>
          {developments.length === 0 ? null : (
            <span className="text-warning">
              · {t("themes.developments", { count: developments.length })}
            </span>
          )}
        </span>
      }
      actions={
        editing ? null : (
          <>
            <Button
              size="sm"
              variant="tertiary"
              isPending={check.isPending}
              onPress={() => check.mutate()}>
              {t("settings.theme-watch.check")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onPress={() => {
                check.reset();
                setEditing(true);
              }}>
              {t("settings.edit")}
            </Button>
          </>
        )
      }>
      {editing ? (
        <ThemeEditor watch={watch} onDone={() => setEditing(false)} />
      ) : (
        <p className="line-clamp-2 text-xs whitespace-pre-wrap text-muted">
          {theme.thesis}
        </p>
      )}
      {check.error ? (
        <ErrorAlert
          title={t("settings.theme-watch.check-failed")}
          description={check.error.message}
        />
      ) : null}
    </SettingsRow>
  );
}

/**
 * The themes the app watches for the user: each written, searched now and removed here. The
 * agent may write one too, once the user allows it.
 */
export function ThemeSettings() {
  const { t } = useTranslation();
  const { data, error, refetch } = useQuery(themesQuery());
  const [adding, setAdding] = useState(false);

  if (error) {
    return (
      <RailedColumn className="px-6 py-5">
        <LoadError error={error} onRetry={() => void refetch()} />
      </RailedColumn>
    );
  }

  if (!data) return <LoadingState />;

  return (
    <Section
      title={t("settings.theme-watch.title")}
      description={t("settings.theme-watch.description-text")}>
      <div className="flex flex-col gap-3">
        {data.length === 0 ? (
          <p className="text-xs text-muted">{t("themes.empty")}</p>
        ) : (
          <SettingsList>
            {data.map((watch) => (
              <ThemeSettingsRow key={watch.theme.id} watch={watch} />
            ))}
          </SettingsList>
        )}
        {adding ? (
          <ThemeEditor onDone={() => setAdding(false)} />
        ) : (
          <Button
            variant="secondary"
            className="self-start"
            onPress={() => setAdding(true)}>
            {t("settings.theme-watch.add")}
          </Button>
        )}
      </div>
    </Section>
  );
}
