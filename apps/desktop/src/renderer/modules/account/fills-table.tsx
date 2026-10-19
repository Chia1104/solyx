import { EmptyState, Table } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { MARKET_TIME_ZONE } from "@solyx/core/market";
import type { Fill } from "@solyx/core/order";

import { orpc } from "../../app/rpc.ts";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { numberFormats } from "../market/number-formats.ts";

import { ListingLink } from "./listing-link.tsx";

/** The newest fills shown; older ones count in the trade review. */
const RECENT_FILLS = 50;

/** When a fill traded, on its market's clock. */
function filledAt(fill: Fill, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: MARKET_TIME_ZONE[fill.instrument.market],
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(fill.filledAt);
}

/** The account's newest fills, newest first, with what each sale gained. */
export function FillsTable() {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);

  const { data, error, refetch } = useQuery(
    orpc.account.fills.queryOptions({ input: undefined })
  );

  if (error) return <LoadError error={error} onRetry={() => void refetch()} />;

  if (!data) return <LoadingState />;

  const recent = data
    .toReversed()
    .slice(0, RECENT_FILLS)
    .map((fill, index) => ({ id: `${fill.orderId}-${index}`, fill }));

  return (
    <div className="flex flex-col gap-2">
      <Table variant="secondary">
        <Table.ScrollContainer>
          <Table.Content aria-label={t("account.fills")}>
            <Table.Header>
              <Table.Column isRowHeader>{t("account.filled-at")}</Table.Column>
              <Table.Column>{t("account.symbol")}</Table.Column>
              <Table.Column>{t("account.side")}</Table.Column>
              <Table.Column>{t("account.shares")}</Table.Column>
              <Table.Column>{t("account.price")}</Table.Column>
              <Table.Column>{t("account.realized")}</Table.Column>
            </Table.Header>
            <Table.Body
              renderEmptyState={() => (
                <EmptyState className="text-center">
                  {t("account.no-fills")}
                </EmptyState>
              )}>
              <Table.Collection items={recent}>
                {({ id, fill }) => (
                  <Table.Row id={id}>
                    <Table.Cell className="tabular-nums">
                      {filledAt(fill, i18n.language)}
                    </Table.Cell>
                    <Table.Cell>
                      <ListingLink symbol={fill.instrument} />
                    </Table.Cell>
                    <Table.Cell>{t(`side.${fill.side}`)}</Table.Cell>
                    <Table.Cell className="tabular-nums">
                      {format.price.format(fill.quantity)}
                    </Table.Cell>
                    <Table.Cell className="tabular-nums">
                      {format.price.format(fill.price)}
                    </Table.Cell>
                    <Table.Cell className="tabular-nums">
                      {fill.realized === null
                        ? "–"
                        : format.signedAmount.format(fill.realized)}
                    </Table.Cell>
                  </Table.Row>
                )}
              </Table.Collection>
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
      {data.length > RECENT_FILLS ? (
        <p className="text-xs text-muted">
          {t("account.recent-fills", { count: RECENT_FILLS })}
        </p>
      ) : null}
    </div>
  );
}
