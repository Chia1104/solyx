import type { TFunction } from "i18next";

import { brokerOfId } from "@solyx/core/broker";
import { isEnumValue } from "@solyx/utils/is";

import { TradingBroker } from "#shared/settings.ts";

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
