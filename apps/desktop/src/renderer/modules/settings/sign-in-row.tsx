import { Button } from "@heroui/react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { ErrorAlert } from "../../components/error-alert.tsx";

import { SettingsRow } from "./settings-list.tsx";

/**
 * An account signed in through the browser, which comes back to this computer on its own. The
 * main process keeps and refreshes what the sign-in grants, and never shows it.
 */
export function SignInRow({
  label,
  description,
  signInLabel,
  signInFailed,
  signedIn,
  needsSignIn,
  onSignIn,
  onCancel,
  onSignOut,
  onSettled,
}: {
  label: string;
  description: string;
  signInLabel: string;
  signInFailed: string;
  /** A sign-in is saved, so it can be signed out of. */
  signedIn: boolean;
  /** Nothing saved works, so signing in is offered. */
  needsSignIn: boolean;
  onSignIn: () => Promise<void>;
  onCancel: () => Promise<void>;
  onSignOut: () => Promise<void>;
  /** Refreshes what reads the account once a sign-in or sign-out settles. */
  onSettled: () => Promise<void>;
}) {
  const { t } = useTranslation();

  const signIn = useMutation({ mutationFn: onSignIn, onSettled });
  const cancel = useMutation({ mutationFn: onCancel });
  const signOut = useMutation({ mutationFn: onSignOut, onSettled });

  const state = signIn.isPending
    ? t("settings.sign-in.waiting")
    : signedIn && !needsSignIn
      ? t("settings.sign-in.signed-in")
      : t("settings.sign-in.signed-out");

  return (
    <SettingsRow
      label={label}
      description={description}
      value={state}
      actions={
        signIn.isPending ? (
          <Button
            size="sm"
            variant="tertiary"
            isPending={cancel.isPending}
            onPress={() => cancel.mutate()}>
            {t("common.cancel")}
          </Button>
        ) : (
          <>
            {needsSignIn ? (
              <Button
                size="sm"
                variant="secondary"
                onPress={() => signIn.mutate()}>
                {signInLabel}
              </Button>
            ) : null}
            {signedIn ? (
              <Button
                size="sm"
                variant="tertiary"
                isPending={signOut.isPending}
                onPress={() => signOut.mutate()}>
                {t("settings.sign-in.sign-out")}
              </Button>
            ) : null}
          </>
        )
      }>
      {signIn.isPending ? (
        <p className="text-xs text-muted">
          {t("settings.sign-in.continue-in-browser")}
        </p>
      ) : null}
      {signIn.error ? (
        <ErrorAlert title={signInFailed} description={signIn.error.message} />
      ) : null}
      {signOut.error ? (
        <ErrorAlert
          title={t("settings.sign-in.sign-out-failed")}
          description={signOut.error.message}
        />
      ) : null}
    </SettingsRow>
  );
}
