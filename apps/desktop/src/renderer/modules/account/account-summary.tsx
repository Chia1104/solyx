import { Button, EmptyState, Table } from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import type { BrokerOrder } from "@solyx/core/broker";
import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { OrderType } from "@solyx/core/order";
import type { Position } from "@solyx/core/order";

import { orpc } from "../../app/rpc.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { Section } from "../../components/section.tsx";
import { ListingName } from "../market/listing-name.tsx";
import { numberFormats } from "../market/number-formats.ts";

export function AccountSummary() {
  const { t, i18n } = useTranslation();

  const { data, error, refetch } = useQuery(
    orpc.account.summary.queryOptions()
  );

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
                  {amount === null
                    ? t("account.cash-unknown")
                    : format.price.format(amount ?? 0)}
                </dd>
              </div>
            ))}
          </dl>
          <PositionsTable positions={data.positions} />
          <WorkingOrders />
        </div>
      ) : (
        <LoadingState />
      )}
    </Section>
  );
}

function ListingLink({ symbol }: { symbol: SymbolRef }) {
  const { t } = useTranslation();

  return (
    <Link
      to="/symbol/$market/$symbol"
      params={{ market: symbol.market, symbol: symbol.symbol }}
      className="flex min-w-0 items-baseline gap-1.5 hover:underline">
      <span className="shrink-0 font-medium">{symbol.symbol}</span>
      <ListingName symbol={symbol} />
      <span className="shrink-0 text-xs text-muted">
        {t(`market.${symbol.market}`)}
      </span>
    </Link>
  );
}

/** Asks the broker to cancel one order; the account's orders then tell what came of it. */
function CancelButton({ id }: { id: string }) {
  const { t } = useTranslation();
  const cancel = useMutation(orpc.account.cancel.mutationOptions());

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        size="sm"
        variant="tertiary"
        isPending={cancel.isPending}
        onPress={() => cancel.mutate(id)}>
        {t("account.cancel")}
      </Button>
      {cancel.error ? (
        <ErrorAlert
          title={t("account.cancel-failed")}
          description={cancel.error.message}
        />
      ) : null}
    </div>
  );
}

/** The day's orders that may still fill, wherever they were placed; none shows nothing. */
function WorkingOrders() {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);
  const { data } = useQuery(orpc.account.working.queryOptions());

  if (!data?.length) return null;

  const price = ({ order }: BrokerOrder) =>
    order.type === OrderType.Limit
      ? format.price.format(order.limitPrice)
      : t("proposals.market-price");

  return (
    <Table variant="secondary">
      <Table.ScrollContainer>
        <Table.Content aria-label={t("account.working")}>
          <Table.Header>
            <Table.Column isRowHeader>{t("account.working")}</Table.Column>
            <Table.Column>{t("account.order")}</Table.Column>
            <Table.Column>{t("account.filled")}</Table.Column>
            <Table.Column>
              <span className="sr-only">{t("account.cancel")}</span>
            </Table.Column>
          </Table.Header>
          <Table.Body>
            <Table.Collection items={data}>
              {(working) => (
                <Table.Row id={working.id}>
                  <Table.Cell>
                    <ListingLink symbol={working.order.instrument} />
                  </Table.Cell>
                  <Table.Cell className="tabular-nums">
                    {t("proposals.summary", {
                      side: t(`side.${working.order.side}`),
                      quantity: working.order.quantity,
                      price: price(working),
                    })}
                  </Table.Cell>
                  <Table.Cell className="tabular-nums">
                    {format.price.format(working.filled)}{" "}
                    <span className="text-xs text-muted">
                      {t(`account.order-status.${working.status}`)}
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <CancelButton id={working.id} />
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
                    <ListingLink symbol={position.instrument} />
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
