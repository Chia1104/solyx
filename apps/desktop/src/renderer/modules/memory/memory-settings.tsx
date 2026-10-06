import { useMemo, useState } from "react";

import {
  Button,
  FieldError,
  Form,
  Input,
  Label,
  TextArea,
  TextField,
} from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { memoize } from "es-toolkit";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import {
  MEMORY_BODY_LENGTH,
  MEMORY_DESCRIPTION_LENGTH,
  holdsSecret,
} from "@solyx/core/memory";
import type { Memory, MemoryChange } from "@solyx/core/memory";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { FilterField, matchesFilter } from "../../components/filter-field.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { Section } from "../../components/section.tsx";
import { RailedColumn } from "../../components/sheet.tsx";
import { ListingName } from "../market/listing-name.tsx";
import { SettingsList, SettingsRow } from "../settings/settings-list.tsx";

import { memoryQuery } from "./memory-query.ts";

const dateFormat = memoize(
  (locale: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" })
);

/** A memory as the user edits it; rebuilt per language so field errors come out localized. */
function useMemoryChangeSchema() {
  const { t } = useTranslation();

  return useMemo(() => {
    const text = (max: number) =>
      z
        .string()
        .trim()
        .max(max, { error: t("settings.memory.too-long", { count: max }) })
        .refine((value) => !holdsSecret(value), {
          error: t("settings.memory.secret"),
        });

    return z.object({
      description: text(MEMORY_DESCRIPTION_LENGTH).pipe(
        z.string().min(1, { error: t("settings.memory.description-required") })
      ),
      body: text(MEMORY_BODY_LENGTH),
    });
  }, [t]);
}

/** One memory: its description, what it is about and when it was written, edited below the row. */
function MemoryRow({ memory }: { memory: Memory }) {
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = useState(false);

  const form = useForm({
    resolver: zodResolver(useMemoryChangeSchema()),
    reValidateMode: "onSubmit",
    defaultValues: { description: memory.description, body: memory.body },
  });

  const save = useMutation({
    mutationFn: (change: MemoryChange) =>
      window.solyx.memory.update(memory.id, change),
    onSuccess: () => setEditing(false),
  });

  const forget = useMutation({
    mutationFn: () => window.solyx.memory.forget(memory.id),
  });

  const submit = form.handleSubmit((change) => save.mutate(change));

  const edit = () => {
    form.reset({ description: memory.description, body: memory.body });
    save.reset();
    setEditing(true);
  };

  const error = save.error ?? forget.error;

  return (
    <SettingsRow
      label={<span className="line-clamp-2">{memory.description}</span>}
      description={
        <span className="flex min-w-0 items-center gap-1">
          <span className="shrink-0">
            {t(`settings.memory.kinds.${memory.kind}`)}
          </span>
          {memory.listing ? (
            <>
              <span className="shrink-0">· {memory.listing.symbol}</span>
              <ListingName symbol={memory.listing} />
            </>
          ) : null}
          <span className="shrink-0">
            · {dateFormat(i18n.language).format(memory.updatedAt)}
          </span>
        </span>
      }
      actions={
        editing ? null : (
          <>
            <Button
              size="sm"
              variant="secondary"
              isDisabled={forget.isPending}
              onPress={edit}>
              {t("settings.edit")}
            </Button>
            <Button
              size="sm"
              variant="tertiary"
              isPending={forget.isPending}
              onPress={() => forget.mutate()}>
              {t("settings.memory.forget")}
            </Button>
          </>
        )
      }>
      {editing ? (
        <Form
          validationBehavior="aria"
          className="flex flex-col gap-3"
          onSubmit={(event) => void submit(event)}>
          <Controller
            control={form.control}
            name="description"
            render={({ field, fieldState }) => (
              <TextField isRequired autoFocus isInvalid={fieldState.invalid}>
                <Label>{t("settings.memory.description")}</Label>
                <Input {...field} autoComplete="off" />
                <FieldError>{fieldState.error?.message}</FieldError>
              </TextField>
            )}
          />
          <Controller
            control={form.control}
            name="body"
            render={({ field, fieldState }) => (
              <TextField isInvalid={fieldState.invalid}>
                <Label>{t("settings.memory.body")}</Label>
                <TextArea {...field} rows={4} />
                <FieldError>{fieldState.error?.message}</FieldError>
              </TextField>
            )}
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="secondary"
              isPending={save.isPending}>
              {t("settings.save")}
            </Button>
            <Button
              variant="tertiary"
              isDisabled={save.isPending}
              onPress={() => setEditing(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </Form>
      ) : memory.body ? (
        <p className="line-clamp-3 text-xs whitespace-pre-wrap text-muted">
          {memory.body}
        </p>
      ) : null}
      {error ? (
        <ErrorAlert
          title={t("settings.memory.change-failed")}
          description={error.message}
        />
      ) : null}
    </SettingsRow>
  );
}

/** What the agent keeps across conversations, each memory rewritten or forgotten here. */
export function MemorySettings() {
  const { t } = useTranslation();
  const { data, error, refetch } = useQuery(memoryQuery());
  const [filter, setFilter] = useState("");

  if (error) {
    return (
      <RailedColumn className="px-6 py-5">
        <LoadError error={error} onRetry={() => void refetch()} />
      </RailedColumn>
    );
  }

  if (!data) return <LoadingState />;

  const shown = data.filter((memory) =>
    matchesFilter(
      filter,
      memory.description,
      memory.body,
      memory.listing?.symbol
    )
  );

  return (
    <Section
      title={t("settings.memory.title")}
      description={t("settings.memory.description-text")}>
      <div className="flex flex-col gap-3">
        {data.length === 0 ? (
          <p className="text-xs text-muted">{t("settings.memory.empty")}</p>
        ) : (
          <>
            <FilterField
              label={t("settings.memory.filter")}
              value={filter}
              onChange={setFilter}
              className="ml-auto w-56"
            />
            {shown.length > 0 ? (
              <SettingsList>
                {shown.map((memory) => (
                  <MemoryRow key={memory.id} memory={memory} />
                ))}
              </SettingsList>
            ) : (
              <p className="text-xs text-muted">
                {t("settings.memory.no-matches", { query: filter.trim() })}
              </p>
            )}
          </>
        )}
      </div>
    </Section>
  );
}
