import { Card, Chip } from "@heroui/react";
import type { ChipProps } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Market } from "@solyx/core/market";
import { Session } from "@solyx/core/session";

import { marketSessionsQuery } from "./market-sessions-query.ts";

const SESSION_COLOR: Record<Session, ChipProps["color"]> = {
  [Session.Pre]: "warning",
  [Session.Regular]: "success",
  [Session.Post]: "warning",
  [Session.Closed]: "default",
};

export function MarketSessionsCard() {
  const { t } = useTranslation();
  const { data, error } = useQuery(marketSessionsQuery());

  return (
    <Card>
      <Card.Header>
        <Card.Title>{t("market-sessions.title")}</Card.Title>
      </Card.Header>
      <Card.Content className="flex flex-row gap-2">
        {error && <p className="text-danger">{error.message}</p>}
        {data &&
          Object.values(Market).map((market) => (
            <Chip key={market} color={SESSION_COLOR[data[market]]}>
              {t("market-sessions.chip", {
                market: t(`market.${market}`),
                session: t(`session.${data[market]}`),
              })}
            </Chip>
          ))}
      </Card.Content>
    </Card>
  );
}
