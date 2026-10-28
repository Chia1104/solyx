import { useTranslation } from "react-i18next";

import type { MarketDataStatus } from "@solyx/api/settings";
import { Market } from "@solyx/core/market";

import { currentLocale } from "../../app/i18n.ts";
import { client } from "../../app/rpc.ts";

import { SettingsList } from "./settings-list.tsx";
import { SignInRow } from "./sign-in-row.tsx";

/** The Longbridge sign-in US quotes come through. */
export function LongbridgeSettings({ status }: { status: MarketDataStatus }) {
  const { t } = useTranslation();
  const signedIn = status.markets[Market.US].ready;

  return (
    <SettingsList>
      <SignInRow
        label={t("settings.longbridge.label")}
        description={t("settings.longbridge.hint")}
        signInLabel={t("settings.longbridge.sign-in")}
        signInFailed={t("settings.longbridge.sign-in-failed")}
        signedIn={signedIn}
        needsSignIn={!signedIn}
        onSignIn={() =>
          client.settings.signInLongbridge({ locale: currentLocale() })
        }
        onCancel={() => client.settings.cancelLongbridgeSignIn()}
        onSignOut={() => client.settings.signOutLongbridge()}
      />
    </SettingsList>
  );
}
