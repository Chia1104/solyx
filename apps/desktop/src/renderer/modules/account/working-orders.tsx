import { Button, EmptyState, Table } from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { BrokerOrder } from "@solyx/core/broker";
import { OrderType } from "@solyx/core/order";

import { orpc } from "../../app/rpc.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
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

/**
 * The day's orders that may still fill, wherever they were placed; none shows nothing unless
 * `showEmpty` says so.
 */
export function WorkingOrders({ showEmpty = false }: { showEmpty?: boolean }) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);
  const { data } = useQuery(orpc.account.working.queryOptions());

  if (!data || (data.length === 0 && !showEmpty)) return null;

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
          <Table.Body
            renderEmptyState={() => (
              <EmptyState className="text-center">
                {t("account.no-working")}
              </EmptyState>
            )}>
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
