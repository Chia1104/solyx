import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  Button,
  FieldError,
  Form,
  Input,
  Label,
  TextField,
} from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { pairingRequestSchema } from "@solyx/api/devices";
import type { PairingRequest } from "@solyx/api/devices";
import { errorMessage } from "@solyx/utils/error";

import { pairDevice } from "../app/device.ts";
import { ErrorAlert } from "../components/error-alert.tsx";

/** Pairs this browser with the code the desktop shows, then opens the workspace. */
function PairingPage() {
  const { t } = useTranslation();
  const [failure, setFailure] = useState<string | null>(null);

  const form = useForm<PairingRequest>({
    resolver: zodResolver(pairingRequestSchema),
    defaultValues: { code: "", name: t("pairing.default-name") },
  });

  const submit = form.handleSubmit(async ({ code, name }) => {
    try {
      await pairDevice(code, name);
      location.reload();
    } catch (error) {
      setFailure(errorMessage(error));
    }
  });

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6">
      <Form
        validationBehavior="aria"
        className="flex w-full max-w-sm flex-col gap-4"
        onSubmit={(event) => void submit(event)}>
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">{t("pairing.title")}</h1>
          <p className="text-sm text-muted">{t("pairing.description")}</p>
        </div>
        <Controller
          control={form.control}
          name="code"
          render={({ field, fieldState }) => (
            <TextField isRequired autoFocus isInvalid={fieldState.invalid}>
              <Label>{t("pairing.code")}</Label>
              <Input
                {...field}
                autoComplete="off"
                spellCheck={false}
                className="font-mono tracking-widest uppercase"
              />
              <FieldError>{fieldState.error?.message}</FieldError>
            </TextField>
          )}
        />
        <Controller
          control={form.control}
          name="name"
          render={({ field, fieldState }) => (
            <TextField isRequired isInvalid={fieldState.invalid}>
              <Label>{t("pairing.name")}</Label>
              <Input {...field} autoComplete="off" />
              <FieldError>{fieldState.error?.message}</FieldError>
            </TextField>
          )}
        />
        {failure ? (
          <ErrorAlert title={t("pairing.failed")} description={failure} />
        ) : null}
        <Button type="submit" isPending={form.formState.isSubmitting}>
          {t("pairing.submit")}
        </Button>
      </Form>
    </main>
  );
}

/** Renders the pairing page in place of the workspace. */
export function showPairing() {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <PairingPage />
    </StrictMode>
  );
}
