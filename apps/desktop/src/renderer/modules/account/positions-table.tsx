import { Button, ButtonGroup, EmptyState, Table } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { Position } from "@solyx/core/order";
import { exitWatched } from "@solyx/core/order-desk";

import { numberFormats } from "../market/number-formats.ts";
import { proposalsQuery } from "../proposals/proposals-query.ts";
import { openSale } from "../proposals/show-ticket.ts";
import { TicketTab } from "../proposals/ticket-store.ts";

import { ListingLink } from "./listing-link.tsx";
import {
  PositionGain,
  PositionLast,
  PositionReturn,
} from "./position-figures.tsx";

/** The stops and targets the broker watches on the listing, each as stop / target. */
export function WatchedExits({ symbol }: { symbol: SymbolRef }) {
  const { i18n } = useTranslation();
  const format = numberFormats(i18n.language);

  const { data } = useQuery({
    ...proposalsQuery(),
    select: (proposals) =>
      proposals.filter(
        (proposal) =>
          exitWatched(proposal) &&
          symbolKey(proposal.order.instrument) === symbolKey(symbol)
      ),
  });

  if (!data?.length) return <span className="text-muted">–</span>;

  const price = (value: number | null) =>
    value === null ? "–" : format.price.format(value);

  return data
    .flatMap(({ exit }) =>
      exit ? [`${price(exit.stop)} / ${price(exit.target)}`] : []
    )
    .join(", ");
}

/** The shares of a holding a sale can draw on now. */
export const sellableOf = (position: Position) =>
  position.sellable ?? position.quantity;

/** What the account holds, marked at each listing's last price, with a sale or an exit a click away. */
export function PositionsTable({ positions }: { positions: Position[] }) {
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
            <Table.Column>{t("account.last")}</Table.Column>
            <Table.Column>{t("account.unrealized-gain")}</Table.Column>
            <Table.Column>{t("account.return")}</Table.Column>
            <Table.Column>{t("account.exits")}</Table.Column>
            <Table.Column>
              <span className="sr-only">{t("account.actions")}</span>
            </Table.Column>
          </Table.Header>
          <Table.Body
            renderEmptyState={() => (
              <EmptyState className="text-center">
                {t("account.no-positions")}
              </EmptyState>
            )}>
            <Table.Collection items={positions}>
              {(position) => {
                const symbol = {
                  market: position.instrument.market,
                  symbol: position.instrument.symbol,
                };

                return (
                  <Table.Row id={symbolKey(symbol)}>
                    <Table.Cell>
                      <ListingLink symbol={symbol} />
                    </Table.Cell>
                    <Table.Cell className="tabular-nums">
                      {format.price.format(position.quantity)}
                    </Table.Cell>
                    <Table.Cell className="tabular-nums">
                      {format.price.format(position.avgPrice)}
                    </Table.Cell>
                    <Table.Cell className="tabular-nums">
                      <PositionLast symbol={symbol} />
                    </Table.Cell>
                    <Table.Cell className="tabular-nums">
                      <PositionGain symbol={symbol} position={position} />
                    </Table.Cell>
                    <Table.Cell className="tabular-nums">
                      <PositionReturn symbol={symbol} position={position} />
                    </Table.Cell>
                    <Table.Cell className="tabular-nums">
                      <WatchedExits symbol={symbol} />
                    </Table.Cell>
                    <Table.Cell>
                      <ButtonGroup
                        size="sm"
                        variant="tertiary"
                        className="ml-auto">
                        <Button
                          onPress={() =>
                            openSale(
                              symbol,
                              sellableOf(position),
                              TicketTab.Order
                            )
                          }>
                          {t("account.sell")}
                        </Button>
                        <Button
                          onPress={() =>
                            openSale(
                              symbol,
                              sellableOf(position),
                              TicketTab.Exit
                            )
                          }>
                          {t("account.set-exit")}
                        </Button>
                      </ButtonGroup>
                    </Table.Cell>
                  </Table.Row>
                );
              }}
            </Table.Collection>
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}
