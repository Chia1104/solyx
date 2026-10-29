import type { ReactNode } from "react";

import { cn } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { BrokerMode } from "@solyx/core/broker";

import { orpc } from "../../app/rpc.ts";

/** Paper trading is drawn in pencil and live trading in ink, like the band under the columns' headers. */
export function BrokerModeChip() {
  const { t } = useTranslation();
  const { data } = useQuery(orpc.account.summary.queryOptions());

  if (!data) return null;

  const paper = data.brokerMode === BrokerMode.Paper;

  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-sm px-2 text-xs font-medium",
        paper ? "pencil text-foreground" : "bg-accent text-accent-foreground"
      )}>
      {t(`broker-mode.${data.brokerMode}`)}
    </span>
  );
}

/** Says which broker orders go to, which the band under every column's header (`broker-rule`) draws. */
export function BrokerModeScope({ children }: { children: ReactNode }) {
  const { data } = useQuery(orpc.account.summary.queryOptions());

  return (
    <div data-broker-mode={data?.brokerMode} className="contents">
      {children}
    </div>
  );
}
