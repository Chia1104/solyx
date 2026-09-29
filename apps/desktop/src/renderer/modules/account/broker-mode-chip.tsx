import { Chip } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { BrokerMode } from "@solyx/core/broker";

import { accountQuery } from "./account-query.ts";

export function BrokerModeChip() {
  const { t } = useTranslation();
  const { data } = useQuery(accountQuery());

  if (!data) return null;

  return (
    <Chip
      color={data.brokerMode === BrokerMode.Paper ? "default" : "danger"}
      size="sm">
      {t(`broker-mode.${data.brokerMode}`)}
    </Chip>
  );
}
