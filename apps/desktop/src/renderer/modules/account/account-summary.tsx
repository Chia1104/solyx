import { EmptyState, Table } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { symbolKey } from "@solyx/core/market";
import type { Position } from "@solyx/core/order";

import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { Section } from "../../components/section.tsx";
import { numberFormats } from "../market/number-formats.ts";

import { accountQuery } from "./account-query.ts";

export function AccountSummary() {
  const { t, i18n } = useTranslation();
  const { data, error, refetch } = useQuery(accountQuery());
  const format = numberFormats(i18n.language);

  return (
    <Section title={t("account.title")}>
      {error ? (
        <LoadError error={error} onRetry={() => void refetch()} />
      ) : data ? (
        <div className="flex flex-col gap-6">
          <dl className="flex flex-wrap gap-x-10 gap-y-3">
            {Object.entries(data.cash).map(([currency, amount]) => (
              <div key={currency} className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted">
                  {t("account.cash")} {currency}
                </dt>
                <dd className="text-xl font-semibold tabular-nums">
                  {format.price.format(amount ?? 0)}
                </dd>
              </div>
            ))}
          </dl>
          <PositionsTable positions={data.positions} />
        </div>
      ) : (
        <LoadingState />
      )}
    </Section>
  );
}

function PositionsTable({ positions }: { positions: Position[] }) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);

  return (
    <Table variant="secondary">
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
                <Table.Row id={symbolKey(position.instrument)}>
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
                  <Table.Cell className="tabular-nums">
                    {format.price.format(position.quantity)}
                  </Table.Cell>
                  <Table.Cell className="tabular-nums">
                    {format.price.format(position.avgPrice)}
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Collection>
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}
