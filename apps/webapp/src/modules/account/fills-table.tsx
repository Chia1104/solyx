import { EmptyState, Table, cn } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { MARKET_TIME_ZONE } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { Fill } from "@solyx/core/order";

import { orpc } from "../../app/rpc.ts";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { PaneSection } from "../../components/pane-section.tsx";
import { numberFormats } from "../market/number-formats.ts";
import { useDirectionColors } from "../market/price-colors.ts";
import { directionOf } from "../market/quote-figures.tsx";

import { ListingLink } from "./listing-link.tsx";

/** The newest fills shown; older ones count in the trade review. */
const RECENT_FILLS = 50;

/** The newest fills a side pane lists, which has less room than a page. */
const PANE_FILLS = 20;

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

/** The account's newest fills, of one listing where `symbol` names it, newest first, with what each sale gained. */
export function FillsTable({ symbol }: { symbol?: SymbolRef }) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);

  const { data, error, refetch } = useQuery(
    orpc.account.fills.queryOptions({ input: symbol })
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
              {symbol ? null : (
                <Table.Column>{t("account.symbol")}</Table.Column>
              )}
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
                    {symbol ? null : (
                      <Table.Cell>
                        <ListingLink symbol={fill.instrument} />
                      </Table.Cell>
                    )}
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

/** What a sale gained or lost, in the colour of a move that way. */
function Realized({ fill }: { fill: Fill }) {
  const { i18n } = useTranslation();
  const direction = useDirectionColors(fill.instrument.market);

  if (fill.realized === null) return null;

  return (
    <span
      className={cn(
        "shrink-0 tabular-nums",
        directionOf(direction, fill.realized)?.text ?? "text-muted"
      )}>
      {numberFormats(i18n.language).signedAmount.format(fill.realized)}
    </span>
  );
}

/** The account's newest fills as a side pane's rows, newest first, with what each sale gained. */
export function FillList() {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);

  const { data, error, refetch } = useQuery(
    orpc.account.fills.queryOptions({ input: undefined })
  );

  return (
    <PaneSection title={t("account.fills")}>
      {error ? (
        <div className="px-4 pb-3">
          <LoadError error={error} onRetry={() => void refetch()} />
        </div>
      ) : !data ? (
        <LoadingState />
      ) : data.length === 0 ? (
        <p className="px-4 pb-3 text-xs text-muted">{t("account.no-fills")}</p>
      ) : (
        <>
          <ul className="flex flex-col">
            {data
              .toReversed()
              .slice(0, PANE_FILLS)
              .map((fill, index) => (
                <li
                  key={`${fill.orderId}-${index}`}
                  className="flex items-start gap-3 px-4 py-2.5 text-sm">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <ListingLink symbol={fill.instrument} />
                    <span className="text-xs text-muted tabular-nums">
                      {filledAt(fill, i18n.language)}
                      {" · "}
                      {t("proposals.summary", {
                        side: t(`side.${fill.side}`),
                        quantity: fill.quantity,
                        price: format.price.format(fill.price),
                      })}
                    </span>
                  </div>
                  <Realized fill={fill} />
                </li>
              ))}
          </ul>
          {data.length > PANE_FILLS ? (
            <p className="px-4 pb-3 text-xs text-muted">
              {t("account.recent-fills", { count: PANE_FILLS })}
            </p>
          ) : null}
        </>
      )}
    </PaneSection>
  );
}
