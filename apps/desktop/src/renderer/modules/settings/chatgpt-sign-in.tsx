import { useTranslation } from "react-i18next";

import { SUBSCRIPTION_PROVIDER } from "@solyx/agent/providers";

import { currentLocale } from "../../app/i18n.ts";

import { SignInRow } from "./sign-in-row.tsx";

/** The ChatGPT account the OpenAI provider runs on when paid by subscription. */
export function ChatGPTSignIn({ signedIn }: { signedIn: boolean }) {
  const { t } = useTranslation();

  return (
    <SignInRow
      label={t("settings.agent.chatgpt.label")}
      description={t("settings.agent.chatgpt.hint")}
      signInLabel={t("settings.agent.chatgpt.sign-in")}
      signInFailed={t("settings.agent.chatgpt.sign-in-failed")}
      signedIn={signedIn}
      needsSignIn={!signedIn}
      onSignIn={() =>
        window.solyx.settings.signInSubscription(
          SUBSCRIPTION_PROVIDER,
          currentLocale()
        )
      }
      onCancel={() => window.solyx.settings.cancelSignIn()}
      onSignOut={() =>
        window.solyx.settings.signOutSubscription(SUBSCRIPTION_PROVIDER)
      }
    />
  );
}
