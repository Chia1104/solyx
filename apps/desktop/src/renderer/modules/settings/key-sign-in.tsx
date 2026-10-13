import { useTranslation } from "react-i18next";

import type { AgentProvider } from "@solyx/agent/providers";

import { currentLocale } from "../../app/i18n.ts";

import { SignInRow } from "./sign-in-row.tsx";

/**
 * A provider that creates its own key once the user signs in to it, shown until a key is saved.
 * The key is then the provider's API key, so it is replaced and removed as a pasted one is.
 */
export function KeySignIn({
  provider,
  name,
}: {
  provider: AgentProvider;
  name: string;
}) {
  const { t } = useTranslation();

  return (
    <SignInRow
      label={t("settings.agent.key-sign-in.label", { provider: name })}
      description={t("settings.agent.key-sign-in.hint", { provider: name })}
      signInLabel={t("settings.agent.key-sign-in.sign-in", { provider: name })}
      signInFailed={t("settings.agent.key-sign-in.sign-in-failed", {
        provider: name,
      })}
      signedIn={false}
      needsSignIn
      onSignIn={() =>
        window.solyx.settings.createAgentKey(provider, currentLocale())
      }
      onCancel={() => window.solyx.settings.cancelSignIn()}
    />
  );
}
