import { Card, EmptyState, Table } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import type { Position } from "@solyx/core/order";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadingState } from "../../components/loading-state.tsx";

import { accountQuery } from "./account-query.ts";

export function AccountCard() {
  const { t, i18n } = useTranslation();
  const { data, error, refetch } = useQuery(accountQuery());

  const formatNumber = (value: number) => value.toLocaleString(i18n.language);

  return (
    <Card>
      <Card.Header>
        <Card.Title>{t("account.title")}</Card.Title>
        {data ? (
          <Card.Description>
            {Object.entries(data.cash)
              .map(
                ([currency, amount]) =>
                  `${currency} ${formatNumber(amount ?? 0)}`
              )
              .join(" · ")}
          </Card.Description>
        ) : null}
      </Card.Header>
      <Card.Content>
        {error ? (
          <ErrorAlert
            title={t("common.load-failed")}
            description={error.message}
            onRetry={() => void refetch()}
          />
        ) : data ? (
          <PositionsTable
            positions={data.positions}
            formatNumber={formatNumber}
          />
        ) : (
          <LoadingState />
        )}
      </Card.Content>
    </Card>
  );
}

function PositionsTable({
  positions,
  formatNumber,
}: {
  positions: Position[];
  formatNumber: (value: number) => string;
}) {
  const { t } = useTranslation();

  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label={t("account.positions")}>
          <Table.Header>
            <Table.Column isRowHeader>{t("account.symbol")}</Table.Column>
            <Table.Column>{t("account.shares")}</Table.Column>
            <Table.Column>{t("account.avg-price")}</Table.Column>
          </Table.Header>
          <Table.Body
            renderEmptyState={() => (
              <EmptyState className="text-center">
                {t("account.no-positions")}
              </EmptyState>
            )}>
            <Table.Collection items={positions}>
              {(position) => (
                <Table.Row
                  id={`${position.instrument.market}:${position.instrument.symbol}`}>
                  <Table.Cell>
                    <Link
                      to="/symbol/$market/$symbol"
                      params={{
                        market: position.instrument.market,
                        symbol: position.instrument.symbol,
                      }}
                      className="hover:underline">
                      {t(`market.${position.instrument.market}`)}{" "}
                      {position.instrument.symbol}
                    </Link>
                  </Table.Cell>
                  <Table.Cell>{formatNumber(position.quantity)}</Table.Cell>
                  <Table.Cell>{formatNumber(position.avgPrice)}</Table.Cell>
                </Table.Row>
              )}
            </Table.Collection>
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}
