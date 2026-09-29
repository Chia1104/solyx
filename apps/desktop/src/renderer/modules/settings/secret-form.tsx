import { useMemo } from "react";

import {
  Button,
  Chip,
  FieldError,
  Form,
  Input,
  Label,
  TextField,
} from "@heroui/react";
import type { ChipProps } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { SecretState } from "#shared/ipc/settings.ts";
import type { Secret } from "#shared/ipc/settings.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { candlesQueryKeys } from "../market/candles-query.ts";

import { settingsQueryKeys } from "./settings-query.ts";

const STATE_COLOR: Record<SecretState, ChipProps["color"]> = {
  [SecretState.Saved]: "success",
  [SecretState.Missing]: "default",
  [SecretState.Unreadable]: "warning",
};

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

/** Saves or removes one secret; the saved value is never read back, so the field always starts empty. */
export function SecretForm({
  secret,
  state,
}: {
  secret: Secret;
  state: SecretState;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const schema = useSecretSchema();

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
    onSuccess: () => form.reset(),
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: () => window.solyx.settings.deleteSecret(secret),
    onSettled: refresh,
  });

  const submit = form.handleSubmit(({ value }) => save.mutate(value));

  return (
    <Form
      validationBehavior="aria"
      className="flex flex-col gap-3"
      onSubmit={(event) => void submit(event)}>
      <Controller
        control={form.control}
        name="value"
        render={({ field, fieldState }) => (
          <TextField
            isRequired
            isInvalid={fieldState.invalid}
            className="max-w-md">
            <div className="flex items-center gap-2">
              <Label>{t(`settings.secrets.${secret}.label`)}</Label>
              <Chip size="sm" color={STATE_COLOR[state]}>
                {t(`settings.secrets.states.${state}`)}
              </Chip>
            </div>
            <Input
              {...field}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={
                state === SecretState.Missing
                  ? t(`settings.secrets.${secret}.placeholder`)
                  : t("settings.secrets.replace-placeholder")
              }
            />
            <FieldError>{fieldState.error?.message}</FieldError>
          </TextField>
        )}
      />
      {state === SecretState.Unreadable ? (
        <p className="text-sm text-warning">
          {t("settings.secrets.unreadable")}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          isPending={save.isPending}
          isDisabled={remove.isPending}>
          {t("settings.secrets.save")}
        </Button>
        {state === SecretState.Missing ? null : (
          <Button
            size="sm"
            variant="tertiary"
            isPending={remove.isPending}
            isDisabled={save.isPending}
            onPress={() => remove.mutate()}>
            {t("settings.secrets.remove")}
          </Button>
        )}
      </div>
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
    </Form>
  );
}
