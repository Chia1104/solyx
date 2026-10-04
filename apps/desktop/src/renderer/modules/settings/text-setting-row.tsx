import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { Button, FieldError, Form, Input, TextField } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { ErrorAlert } from "../../components/error-alert.tsx";

import { SettingsRow } from "./settings-list.tsx";

/**
 * A setting typed as text, such as a model id or a URL. Editing opens a field below the row with
 * the current value, and a value other than the default can go back to it.
 */
export function TextSettingRow({
  label,
  description,
  value,
  isDefault,
  schema,
  onSave,
  onSettled,
}: {
  label: string;
  description?: ReactNode;
  value: string;
  isDefault: boolean;
  /** Validates the entered text, with localized messages. */
  schema: z.ZodType<string, string>;
  /** `null` goes back to the default. */
  onSave: (value: string | null) => Promise<void>;
  /** Refreshes what reads the setting once a save settles. */
  /** Refreshes what the change reaches that the settings push does not. */
  onSettled?: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);

  const formSchema = useMemo(() => z.object({ value: schema }), [schema]);

  const form = useForm({
    resolver: zodResolver(formSchema),
    reValidateMode: "onSubmit",
    defaultValues: { value },
  });

  const save = useMutation({
    mutationFn: onSave,
    onSuccess: () => setEditing(false),
    onSettled,
  });

  const submit = form.handleSubmit(({ value: next }) => save.mutate(next));

  const edit = () => {
    form.reset({ value });
    save.reset();
    setEditing(true);
  };

  return (
    <SettingsRow
      label={label}
      description={description}
      value={editing ? null : value}
      actions={
        editing ? null : (
          <>
            <Button
              size="sm"
              variant="secondary"
              isDisabled={save.isPending}
              onPress={edit}>
              {t("settings.edit")}
            </Button>
            {isDefault ? null : (
              <Button
                size="sm"
                variant="tertiary"
                isPending={save.isPending}
                onPress={() => save.mutate(null)}>
                {t("settings.use-default")}
              </Button>
            )}
          </>
        )
      }>
      {editing ? (
        <Form
          validationBehavior="aria"
          className="flex items-start gap-2"
          onSubmit={(event) => void submit(event)}>
          <Controller
            control={form.control}
            name="value"
            render={({ field, fieldState }) => (
              <TextField
                isRequired
                autoFocus
                aria-label={label}
                isInvalid={fieldState.invalid}
                className="grow">
                <Input {...field} autoComplete="off" spellCheck={false} />
                <FieldError>{fieldState.error?.message}</FieldError>
              </TextField>
            )}
          />
          <Button type="submit" variant="secondary" isPending={save.isPending}>
            {t("settings.save")}
          </Button>
          <Button
            variant="tertiary"
            isDisabled={save.isPending}
            onPress={() => setEditing(false)}>
            {t("common.cancel")}
          </Button>
        </Form>
      ) : null}
      {save.error ? (
        <ErrorAlert
          title={t("settings.save-failed")}
          description={save.error.message}
        />
      ) : null}
    </SettingsRow>
  );
}
