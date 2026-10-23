import { useEffect, useState } from "react";

import { useTranslation } from "react-i18next";

import type { AgentProvider } from "@solyx/agent/providers";
import type { SignInCode } from "@solyx/api/settings";

import { currentLocale } from "../../app/i18n.ts";
import { client, forEachEvent } from "../../app/rpc.ts";

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

  useEffect(() => {
    const stop = new AbortController();
    const { signal } = stop;

    void forEachEvent(
      client.settings.signInCodes(undefined, { signal }),
      (next) => {
        if (next.provider === provider) setCode(next);
      },
      signal
    );

    return () => stop.abort();
  }, [provider]);

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

        return client.settings.signInSubscription({
          provider,
          locale: currentLocale(),
        });
      }}
      onCancel={() => client.settings.cancelSignIn()}
      onSignOut={() => client.settings.signOutSubscription(provider)}
    />
  );
}
