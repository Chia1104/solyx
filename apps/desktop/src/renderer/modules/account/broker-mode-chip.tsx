import { cn } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { BrokerMode } from "@solyx/core/broker";

import { accountQuery } from "./account-query.ts";

/** Paper trading is drawn in pencil and live trading in ink, like the band under the title bar. */
export function BrokerModeChip() {
  const { t } = useTranslation();
  const { data } = useQuery(accountQuery());

  if (!data) return null;

  const paper = data.brokerMode === BrokerMode.Paper;

  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-sm px-2 text-xs font-medium",
        paper
          ? "border border-dashed border-border bg-background hatch text-foreground"
          : "bg-accent text-accent-foreground"
      )}>
      {t(`broker-mode.${data.brokerMode}`)}
    </span>
  );
}

/** The strip under the title bar: hatching while trades are paper, a solid ink line once they are real. */
export function BrokerModeRule() {
  const { data } = useQuery(accountQuery());

  const live = data?.brokerMode === BrokerMode.Live;

  return (
    <div
      aria-hidden
      className={cn("shrink-0", live ? "h-0.5 bg-accent" : "h-1.5 hatch")}
    />
  );
}
