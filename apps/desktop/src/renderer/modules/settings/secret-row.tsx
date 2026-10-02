import { useMemo, useState } from "react";

import {
  Alert,
  Button,
  FieldError,
  Form,
  Input,
  TextField,
} from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { SecretState } from "#shared/ipc/settings.ts";
import type { EnteredSecret } from "#shared/ipc/settings.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { candlesQueryKeys } from "../market/candles-query.ts";

import { SettingsRow } from "./settings-list.tsx";
import { settingsQueryKeys } from "./settings-query.ts";

/** Rebuilt per language so the field error comes out localized. */
function useSecretSchema() {
  const { t } = useTranslation();

  return useMemo(
    () =>
      z.object({
        value: z
          .string()
          .trim()
          .min(1, { error: t("settings.secrets.required") }),
      }),
    [t]
  );
}

/**
 * One secret with its state. The saved value is never read back, so setting or replacing it
 * opens an empty field in the row.
 */
export function SecretRow({
  secret,
  state,
  available,
  optional = false,
}: {
  secret: EnteredSecret;
  state: SecretState;
  /** False when the OS has no secret store, so nothing can be saved. */
  available: boolean;
  optional?: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const schema = useSecretSchema();
  const [editing, setEditing] = useState(false);

  const form = useForm({
    resolver: zodResolver(schema),
    reValidateMode: "onSubmit",
    defaultValues: { value: "" },
  });

  // Market data reads secrets per request, so charts refetch with the new value.
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: settingsQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: candlesQueryKeys.all }),
    ]);

  const save = useMutation({
    mutationFn: (value: string) =>
      window.solyx.settings.saveSecret(secret, value),
    onSuccess: () => {
      form.reset();
      setEditing(false);
    },
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: () => window.solyx.settings.deleteSecret(secret),
    onSettled: refresh,
  });

  const submit = form.handleSubmit(({ value }) => save.mutate(value));

  const cancel = () => {
    form.reset();
    save.reset();
    setEditing(false);
  };

  const label = t(`settings.secrets.${secret}.label`);

  return (
    <SettingsRow
      label={
        optional ? (
          <>
            {label}{" "}
            <span className="font-normal text-muted">
              {t("settings.secrets.optional")}
            </span>
          </>
        ) : (
          label
        )
      }
      description={t(`settings.secrets.${secret}.hint`)}
      value={
        <span
          className={state === SecretState.Unreadable ? "text-warning" : ""}>
          {t(`settings.secrets.states.${state}`)}
        </span>
      }
      actions={
        editing ? null : (
          <>
            <Button
              size="sm"
              variant="secondary"
              isDisabled={!available || remove.isPending}
              onPress={() => setEditing(true)}>
              {state === SecretState.Missing
                ? t("settings.secrets.set")
                : t("settings.secrets.replace")}
            </Button>
            {state === SecretState.Missing ? null : (
              <Button
                size="sm"
                variant="tertiary"
                isPending={remove.isPending}
                onPress={() => remove.mutate()}>
                {t("settings.secrets.remove")}
              </Button>
            )}
          </>
        )
      }>
      {state === SecretState.Unreadable ? (
        <p className="text-xs text-warning">
          {t("settings.secrets.unreadable")}
        </p>
      ) : null}
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
                <Input
                  {...field}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={
                    state === SecretState.Missing
                      ? undefined
                      : t("settings.secrets.replace-placeholder")
                  }
                />
                <FieldError>{fieldState.error?.message}</FieldError>
              </TextField>
            )}
          />
          <Button type="submit" variant="secondary" isPending={save.isPending}>
            {t("settings.secrets.save")}
          </Button>
          <Button
            variant="tertiary"
            isDisabled={save.isPending}
            onPress={cancel}>
            {t("common.cancel")}
          </Button>
        </Form>
      ) : null}
      {save.error ? (
        <ErrorAlert
          title={t("settings.secrets.save-failed")}
          description={save.error.message}
        />
      ) : null}
      {remove.error ? (
        <ErrorAlert
          title={t("settings.secrets.remove-failed")}
          description={remove.error.message}
        />
      ) : null}
    </SettingsRow>
  );
}

/** Shown instead of saving anything where the OS offers no secret store. */
export function SecretsUnavailable() {
  const { t } = useTranslation();

  return (
    <Alert status="warning">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{t("settings.secrets.unavailable")}</Alert.Title>
      </Alert.Content>
    </Alert>
  );
}
