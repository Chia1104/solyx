import { Button, EmptyState, Table } from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { BrokerOrder } from "@solyx/core/broker";
import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { OrderType } from "@solyx/core/order";

import { inWindow } from "../../app/device.ts";
import { orpc } from "../../app/rpc.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { PaneSection } from "../../components/pane-section.tsx";
import { numberFormats } from "../market/number-formats.ts";

import { ListingLink } from "./listing-link.tsx";

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
        isDisabled={!inWindow}
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

/** The order as one line: side, shares and its limit or the market. */
function OrderSummary({ working: { order } }: { working: BrokerOrder }) {
  const { t, i18n } = useTranslation();

  return t("proposals.summary", {
    side: t(`side.${order.side}`),
    quantity: order.quantity,
    price:
      order.type === OrderType.Limit
        ? numberFormats(i18n.language).price.format(order.limitPrice)
        : t("proposals.market-price"),
  });
}

/**
 * The day's orders that may still fill, wherever they were placed, of one listing where `symbol`
 * names it; none shows nothing unless `showEmpty` says so.
 */
export function WorkingOrders({
  symbol,
  showEmpty = false,
}: {
  symbol?: SymbolRef;
  showEmpty?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);

  const { data } = useQuery({
    ...orpc.account.working.queryOptions(),
    select: (orders) =>
      symbol
        ? orders.filter(
            ({ order }) => symbolKey(order.instrument) === symbolKey(symbol)
          )
        : orders,
  });

  if (!data || (data.length === 0 && !showEmpty)) return null;

  return (
    <Table variant="secondary">
      <Table.ScrollContainer>
        <Table.Content aria-label={t("account.working")}>
          <Table.Header>
            {symbol ? null : (
              <Table.Column isRowHeader>{t("account.symbol")}</Table.Column>
            )}
            <Table.Column isRowHeader={symbol !== undefined}>
              {t("account.order")}
            </Table.Column>
            <Table.Column>{t("account.filled")}</Table.Column>
            <Table.Column>
              <span className="sr-only">{t("account.cancel")}</span>
            </Table.Column>
          </Table.Header>
          <Table.Body
            renderEmptyState={() => (
              <EmptyState className="text-center">
                {t("account.no-working")}
              </EmptyState>
            )}>
            <Table.Collection items={data}>
              {(working) => (
                <Table.Row id={working.id}>
                  {symbol ? null : (
                    <Table.Cell>
                      <ListingLink symbol={working.order.instrument} />
                    </Table.Cell>
                  )}
                  <Table.Cell className="tabular-nums">
                    <OrderSummary working={working} />
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

/** The day's orders that may still fill, as a side pane's rows, each with its cancel. */
export function WorkingOrderList() {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);

  const { data, error, refetch } = useQuery(
    orpc.account.working.queryOptions()
  );

  return (
    <PaneSection title={t("account.working")} count={data?.length}>
      {error ? (
        <div className="px-4 pb-3">
          <LoadError error={error} onRetry={() => void refetch()} />
        </div>
      ) : !data ? (
        <LoadingState />
      ) : data.length === 0 ? (
        <p className="px-4 pb-3 text-xs text-muted">
          {t("account.no-working")}
        </p>
      ) : (
        <ul className="divide-y divide-separator">
          {data.map((working) => (
            <li
              key={working.id}
              className="flex items-start gap-3 px-4 py-2.5 text-sm">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <ListingLink symbol={working.order.instrument} />
                <span className="tabular-nums">
                  <OrderSummary working={working} />
                </span>
                <span className="text-xs text-muted tabular-nums">
                  {t("account.filled")} {format.price.format(working.filled)}
                  {" · "}
                  {t(`account.order-status.${working.status}`)}
                </span>
              </div>
              <CancelButton id={working.id} />
            </li>
          ))}
        </ul>
      )}
    </PaneSection>
  );
}
