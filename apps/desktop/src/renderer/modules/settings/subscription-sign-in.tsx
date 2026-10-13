import { useEffect, useState } from "react";

import { useTranslation } from "react-i18next";

import type { AgentProvider } from "@solyx/agent/providers";

import type { SignInCode } from "#shared/ipc/settings.ts";

import { currentLocale } from "../../app/i18n.ts";

import { SignInRow } from "./sign-in-row.tsx";

/** The account a provider runs on when paid by subscription, signed in on the provider's own page. */
export function SubscriptionSignIn({
  provider,
  name,
  plan,
  signedIn,
}: {
  provider: AgentProvider;
  name: string;
  /** The subscription's own name, a brand name shown as it is. */
  plan: string;
  signedIn: boolean;
}) {
  const { t } = useTranslation();
  // The code of the sign-in under way, where the provider's runs on one.
  const [code, setCode] = useState<SignInCode | null>(null);

  useEffect(
    () =>
      window.solyx.settings.onSignInCode((next) => {
        if (next.provider === provider) setCode(next);
      }),
    [provider]
  );

  return (
    <SignInRow
      label={t("settings.agent.subscription.label", { provider: name })}
      description={t("settings.agent.subscription.hint", { provider: name })}
      signInLabel={t("settings.agent.subscription.sign-in", { plan })}
      signInFailed={t("settings.agent.subscription.sign-in-failed", { plan })}
      signedIn={signedIn}
      needsSignIn={!signedIn}
      code={code}
      onSignIn={() => {
        setCode(null);

        return window.solyx.settings.signInSubscription(
          provider,
          currentLocale()
        );
      }}
      onCancel={() => window.solyx.settings.cancelSignIn()}
      onSignOut={() => window.solyx.settings.signOutSubscription(provider)}
    />
  );
}
