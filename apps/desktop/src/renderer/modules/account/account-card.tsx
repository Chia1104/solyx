import { Card, Table } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { accountQuery } from "./account-query.ts";

export function AccountCard() {
  const { t, i18n } = useTranslation();
  const { data, error } = useQuery(accountQuery());

  if (error) return <p className="text-danger">{error.message}</p>;

  if (!data) return <p className="text-muted">{t("common.loading")}</p>;

  const formatNumber = (value: number) => value.toLocaleString(i18n.language);

  const cash = Object.entries(data.cash)
    .map(([currency, amount]) => `${currency} ${formatNumber(amount ?? 0)}`)
    .join(" · ");

  return (
    <Card>
      <Card.Header>
        <Card.Title>{t("account.title")}</Card.Title>
        <Card.Description>{cash}</Card.Description>
      </Card.Header>
      <Card.Content>
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
                  <p className="p-4 text-center text-muted">
                    {t("account.no-positions")}
                  </p>
                )}>
                <Table.Collection items={data.positions}>
                  {(position) => (
                    <Table.Row
                      id={`${position.instrument.market}:${position.instrument.symbol}`}>
                      <Table.Cell>
                        {t(`market.${position.instrument.market}`)}{" "}
                        {position.instrument.symbol}
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
      </Card.Content>
    </Card>
  );
}
