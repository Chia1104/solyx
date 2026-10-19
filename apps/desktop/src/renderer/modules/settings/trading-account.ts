import type { TFunction } from "i18next";

import { brokerOfId } from "@solyx/core/broker";
import { isEnumValue } from "@solyx/utils/is";

import { FubonSessionState, TradingBroker } from "#shared/settings.ts";
import type { FubonSessionStatus } from "#shared/settings.ts";

/** The broker and account a `brokerId` names, as the user reads them: the paper account, or a Fubon account's number. */
export function tradingAccountLabel(t: TFunction, id: string): string {
  const { broker, account } = brokerOfId(id);

  if (!isEnumValue(TradingBroker, broker)) return id;

  return account === null
    ? t(`settings.trading.brokers.${broker}`)
    : t("settings.trading.broker-account", {
        broker: t(`settings.trading.brokers.${broker}`),
        account,
      });
}

/**
 * The Fubon accounts the user may pick, and whether the one picked is gone. Until a sign-in lists
 * them, the one picked stays offered; one that lists them without it says it is gone, so it is no
 * longer offered.
 */
export function fubonChoices(
  session: FubonSessionStatus | undefined,
  picked: string | null
) {
  if (session?.state === FubonSessionState.SignedIn) {
    return {
      accounts: session.stockAccounts,
      gone:
        picked !== null &&
        !session.stockAccounts.some(({ id }) => id === picked),
    };
  }

  return {
    accounts: picked === null ? [] : [{ id: picked, name: "" }],
    gone: false,
  };
}
