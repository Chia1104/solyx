import { Button } from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { ErrorAlert } from "../../components/error-alert.tsx";

import { SettingsRow } from "./settings-list.tsx";
import { settingsQueryKeys } from "./settings-query.ts";

/**
 * The ChatGPT account the OpenAI provider runs on when paid by subscription. Signing in happens
 * in the browser and comes back to this computer on its own; the main process saves the tokens
 * and refreshes them, and never shows them.
 */
export function ChatGPTSignIn({ signedIn }: { signedIn: boolean }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: settingsQueryKeys.all });

  const signIn = useMutation({
    mutationFn: () => window.solyx.settings.signInSubscription(i18n.language),
    onSettled: refresh,
  });

  const cancel = useMutation({
    mutationFn: () => window.solyx.settings.cancelSignIn(),
  });

  const signOut = useMutation({
    mutationFn: () => window.solyx.settings.signOutSubscription(),
    onSettled: refresh,
  });

  const state = signIn.isPending
    ? t("settings.agent.chatgpt.waiting")
    : signedIn
      ? t("settings.agent.chatgpt.signed-in")
      : t("settings.agent.chatgpt.signed-out");

  return (
    <SettingsRow
      label={t("settings.agent.chatgpt.label")}
      description={t("settings.agent.chatgpt.hint")}
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
        ) : signedIn ? (
          <Button
            size="sm"
            variant="tertiary"
            isPending={signOut.isPending}
            onPress={() => signOut.mutate()}>
            {t("settings.agent.chatgpt.sign-out")}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onPress={() => signIn.mutate()}>
            {t("settings.agent.chatgpt.sign-in")}
          </Button>
        )
      }>
      {signIn.isPending ? (
        <p className="text-xs text-muted">
          {t("settings.agent.chatgpt.continue-in-browser")}
        </p>
      ) : null}
      {signIn.error ? (
        <ErrorAlert
          title={t("settings.agent.chatgpt.sign-in-failed")}
          description={signIn.error.message}
        />
      ) : null}
      {signOut.error ? (
        <ErrorAlert
          title={t("settings.agent.chatgpt.sign-out-failed")}
          description={signOut.error.message}
        />
      ) : null}
    </SettingsRow>
  );
}
