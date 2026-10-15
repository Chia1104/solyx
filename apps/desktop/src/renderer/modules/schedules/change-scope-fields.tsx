import type { ReactNode } from "react";

import { Checkbox, CheckboxGroup, FieldError, Label } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { uniqBy } from "es-toolkit";
import type { TFunction } from "i18next";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";

import {
  ChangeKind,
  watchesListings,
  watchesThemes,
} from "@solyx/core/changes";
import type { Change, ChangeScope } from "@solyx/core/changes";
import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import { orpc } from "../../app/rpc.ts";
import { OptionSelect } from "../../components/option-select.tsx";
import { ListingName } from "../market/listing-name.tsx";
import { themesQuery } from "../themes/themes-query.ts";
import { watchlistQuery } from "../watchlist/watchlist-query.ts";

import type { TimingForm } from "./timing-fields.tsx";

const EVERY = "every";

const NAMED = "named";

/** One choice in a group of boxes, its label beside the box. */
function Choice({ value, children }: { value: string; children: ReactNode }) {
  return (
    <Checkbox value={value}>
      <Checkbox.Content>
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
        {children}
      </Checkbox.Content>
    </Checkbox>
  );
}

/**
 * Which changes a task that waits on one runs for: its kinds, then the listings and themes they
 * come from, every one unless the user picks some. The listings offered are those the user holds
 * and watches, and the themes those kept, each with any the task already names.
 */
export function ChangeScopeFields({
  kept,
}: {
  /** What the task named as it was opened, offered even once it is no longer followed or kept. */
  kept: Pick<TimingForm, "listings" | "themes">;
}) {
  const { t } = useTranslation();
  const { control } = useFormContext<TimingForm>();

  const [kinds, everyListing, everyTheme] = useWatch({
    control,
    name: ["changeKinds", "everyListing", "everyTheme"],
  });

  const watchlist = useQuery(watchlistQuery());
  const account = useQuery(orpc.account.summary.queryOptions());
  const themes = useQuery(themesQuery());

  const listings = uniqBy(
    [
      ...kept.listings,
      ...(account.data?.positions.map(({ instrument }) => instrument) ?? []),
      ...(watchlist.data ?? []),
    ],
    symbolKey
  );

  const titles = new Map(
    themes.data?.map(({ theme }) => [theme.id, theme.title]) ?? []
  );

  const themeIds = [...new Set([...kept.themes, ...titles.keys()])];

  return (
    <div className="flex flex-col gap-3">
      <Controller
        control={control}
        name="changeKinds"
        render={({ field, fieldState }) => (
          <CheckboxGroup
            isRequired
            isInvalid={fieldState.invalid}
            value={field.value}
            onChange={(value) =>
              field.onChange(
                Object.values(ChangeKind).filter((kind) => value.includes(kind))
              )
            }>
            <Label>{t("settings.schedules.scope.kinds")}</Label>
            {Object.values(ChangeKind).map((kind) => (
              <Choice key={kind} value={kind}>
                {t(`settings.schedules.scope.kind-names.${kind}`)}
              </Choice>
            ))}
            <FieldError>{fieldState.error?.message}</FieldError>
          </CheckboxGroup>
        )}
      />
      {watchesListings({ kinds }) ? (
        <>
          <div className="grid gap-3 @min-[40rem]/main:grid-cols-3">
            <Controller
              control={control}
              name="everyListing"
              render={({ field }) => (
                <OptionSelect
                  label={t("settings.schedules.scope.listings")}
                  options={[
                    {
                      id: EVERY,
                      label: t("settings.schedules.scope.every-listing"),
                    },
                    {
                      id: NAMED,
                      label: t("settings.schedules.scope.named-listings"),
                    },
                  ]}
                  value={field.value ? EVERY : NAMED}
                  onChange={(id) => field.onChange(id === EVERY)}
                />
              )}
            />
          </div>
          {everyListing ? null : (
            <Controller
              control={control}
              name="listings"
              render={({ field, fieldState }) => (
                <CheckboxGroup
                  aria-label={t("settings.schedules.scope.named-listings")}
                  isInvalid={fieldState.invalid}
                  className="grid gap-2 @min-[40rem]/main:grid-cols-3"
                  value={field.value.map(symbolKey)}
                  onChange={(keys) =>
                    field.onChange(
                      listings.filter((each) => keys.includes(symbolKey(each)))
                    )
                  }>
                  {listings.length === 0 ? (
                    <p className="text-xs text-muted">
                      {t("settings.schedules.scope.no-listings")}
                    </p>
                  ) : null}
                  {listings.map((each) => (
                    <Choice key={symbolKey(each)} value={symbolKey(each)}>
                      <span className="flex min-w-0 items-baseline gap-1.5">
                        <span className="shrink-0">{each.symbol}</span>
                        <ListingName
                          symbol={each}
                          className="text-xs text-muted"
                        />
                      </span>
                    </Choice>
                  ))}
                  <FieldError className="col-span-full">
                    {fieldState.error?.message}
                  </FieldError>
                </CheckboxGroup>
              )}
            />
          )}
        </>
      ) : null}
      {watchesThemes({ kinds }) ? (
        <>
          <div className="grid gap-3 @min-[40rem]/main:grid-cols-3">
            <Controller
              control={control}
              name="everyTheme"
              render={({ field }) => (
                <OptionSelect
                  label={t("settings.schedules.scope.themes")}
                  options={[
                    {
                      id: EVERY,
                      label: t("settings.schedules.scope.every-theme"),
                    },
                    {
                      id: NAMED,
                      label: t("settings.schedules.scope.named-themes"),
                    },
                  ]}
                  value={field.value ? EVERY : NAMED}
                  onChange={(id) => field.onChange(id === EVERY)}
                />
              )}
            />
          </div>
          {everyTheme ? null : (
            <Controller
              control={control}
              name="themes"
              render={({ field, fieldState }) => (
                <CheckboxGroup
                  aria-label={t("settings.schedules.scope.named-themes")}
                  isInvalid={fieldState.invalid}
                  value={field.value}
                  onChange={(ids) =>
                    field.onChange(themeIds.filter((id) => ids.includes(id)))
                  }>
                  {themeIds.length === 0 ? (
                    <p className="text-xs text-muted">
                      {t("settings.schedules.scope.no-themes")}
                    </p>
                  ) : null}
                  {themeIds.map((id) => (
                    <Choice key={id} value={id}>
                      {titles.get(id) ?? id}
                    </Choice>
                  ))}
                  <FieldError>{fieldState.error?.message}</FieldError>
                </CheckboxGroup>
              )}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

const listingText = ({ market, symbol }: SymbolRef) => `${market} ${symbol}`;

/**
 * What a task that waits on a change runs for, in a line: its kinds, then the listings and themes
 * they come from, a theme by its title while it is kept.
 */
export function useScopeText() {
  const { t } = useTranslation();
  const themes = useQuery(themesQuery());

  return (scope: ChangeScope) => {
    const { kinds, listings, themes: ids } = scope;

    const titles = new Map(
      themes.data?.map(({ theme }) => [theme.id, theme.title]) ?? []
    );

    return [
      kinds
        .map((kind) => t(`settings.schedules.scope.kind-short.${kind}`))
        .join(t("settings.schedules.scope.separator")),
      ...(watchesListings(scope)
        ? [
            listings === null
              ? t("settings.schedules.scope.every-listing")
              : listings
                  .map(listingText)
                  .join(t("settings.schedules.scope.separator")),
          ]
        : []),
      ...(watchesThemes(scope)
        ? [
            ids === null
              ? t("settings.schedules.scope.every-theme")
              : t("settings.schedules.scope.named", {
                  themes: ids
                    .map((id) => titles.get(id) ?? id)
                    .join(t("settings.schedules.scope.separator")),
                }),
          ]
        : []),
    ].join(" · ");
  };
}

/** A change a run was started for, in a line. */
export function changeLine(t: TFunction, change: Change): string {
  switch (change.kind) {
    case ChangeKind.FalsifierMet:
      return t("settings.schedules.scope.changes.falsifier-met", {
        listing: listingText(change.symbol),
        falsifier: change.falsifier,
      });
    case ChangeKind.EventPassed:
      return t("settings.schedules.scope.changes.event-passed", {
        listing: listingText(change.symbol),
        date: change.date,
        label: change.label,
      });
    case ChangeKind.SignpostMet:
      return t("settings.schedules.scope.changes.signpost-met", {
        theme: change.theme,
        signpost: change.signpost,
      });
  }
}
