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
import {
  browserSupportsWebAuthn,
  startRegistration,
} from "@simplewebauthn/browser";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { pairingRequestSchema } from "@solyx/api/devices";
import type { PairingRequest } from "@solyx/api/devices";
import { errorMessage } from "@solyx/utils/error";

import { pairDevice } from "../app/device.ts";
import { ErrorAlert } from "../components/error-alert.tsx";

// A passkey binds to a domain, and browsers bind none to an IP address, so only a page at
// localhost can add one.
const passkeys = location.hostname === "localhost" && browserSupportsWebAuthn();

/**
 * Offers to add a passkey right after pairing, the only time the backend takes one, so this
 * browser can submit and cancel orders; either way it then opens the workspace.
 */
function PasskeyStep() {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function add() {
    setAdding(true);
    setFailure(null);

    try {
      // Imported only now: the client connects as it loads, which takes the token pairing kept.
      const { client } = await import("../app/rpc.ts");

      await client.devices.addPasskey(
        await startRegistration({
          optionsJSON: await client.devices.passkeyOptions(),
        })
      );
      location.reload();
    } catch (error) {
      setFailure(errorMessage(error));
      setAdding(false);
    }
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{t("pairing.passkey.title")}</h1>
        <p className="text-sm text-muted">{t("pairing.passkey.description")}</p>
      </div>
      {failure ? (
        <ErrorAlert title={t("pairing.passkey.failed")} description={failure} />
      ) : null}
      <div className="flex gap-2">
        <Button isPending={adding} onPress={() => void add()}>
          {t("pairing.passkey.add")}
        </Button>
        <Button
          variant="tertiary"
          isDisabled={adding}
          onPress={() => location.reload()}>
          {t("pairing.passkey.skip")}
        </Button>
      </div>
    </div>
  );
}

/** Pairs this browser with the code the desktop shows, then opens the workspace. */
function PairingPage() {
  const { t } = useTranslation();
  const [failure, setFailure] = useState<string | null>(null);
  const [paired, setPaired] = useState(false);

  const form = useForm<PairingRequest>({
    resolver: zodResolver(pairingRequestSchema),
    defaultValues: { code: "", name: t("pairing.default-name") },
  });

  const submit = form.handleSubmit(async ({ code, name }) => {
    try {
      await pairDevice(code, name);

      if (passkeys) setPaired(true);
      else location.reload();
    } catch (error) {
      setFailure(errorMessage(error));
    }
  });

  if (paired) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background p-6">
        <PasskeyStep />
      </main>
    );
  }

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
