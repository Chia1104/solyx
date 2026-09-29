import { cn } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Market } from "@solyx/core/market";
import { Session } from "@solyx/core/session";

import { marketSessionsQuery } from "./market-sessions-query.ts";

// Inked while the regular session trades, outlined around it, empty when closed.
const SESSION_MARK: Record<Session, string> = {
  [Session.Pre]: "border border-accent",
  [Session.Regular]: "bg-accent",
  [Session.Post]: "border border-accent",
  [Session.Closed]: "border border-muted",
};

/** Each market's current session, compact enough for the title bar. */
export function MarketSessions() {
  const { t } = useTranslation();
  const { data } = useQuery(marketSessionsQuery());

  if (!data) return null;

  return (
    <ul
      aria-label={t("market-sessions.title")}
      className="flex items-center gap-4 text-xs">
      {Object.values(Market).map((market) => (
        <li key={market} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn("size-1.5 rounded-full", SESSION_MARK[data[market]])}
          />
          <span className="text-muted">{t(`market.${market}`)}</span>
          <span>{t(`session.${data[market]}`)}</span>
        </li>
      ))}
    </ul>
  );
}
