import { Button, ButtonGroup, cn } from "@heroui/react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Currency, Market, currencyOf, symbolKey } from "@solyx/core/market";
import { positionValue } from "@solyx/core/order";
import type { Position } from "@solyx/core/order";
import { recordsByStance } from "@solyx/core/review";
import type { RoundTrip } from "@solyx/core/review";

import { orpc } from "../../app/rpc.ts";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { PaneSection } from "../../components/pane-section.tsx";
import { numberFormats } from "../market/number-formats.ts";
import { useDirectionColors } from "../market/price-colors.ts";
import { directionOf } from "../market/quote-figures.tsx";
import { quoteQuery } from "../market/quote-query.ts";
import { openSale } from "../proposals/show-ticket.ts";
import { TicketTab } from "../proposals/ticket-store.ts";

import { ListingLink } from "./listing-link.tsx";
import {
  PositionGain,
  PositionLast,
  PositionReturn,
} from "./position-figures.tsx";
import { WatchedExits, sellableOf } from "./positions-table.tsx";
import { RealizedTrend } from "./realized-trend.tsx";

/** The market whose prices a currency's figures move with, for the colours of their direction. */
const marketOf = (currency: Currency) =>
  Object.values(Market).find((market) => currencyOf(market) === currency) ??
  Market.TW;

/**
 * What a currency's holdings are worth at their last prices against what they cost; `null`
 * until every one of their quotes has loaded, so a sum never leaves one out.
 */
function useMarked(positions: Position[]) {
  const quotes = useQueries({
    queries: positions.map((position) => quoteQuery(position.instrument)),
  });

  let value = 0;
  let cost = 0;

  for (const [index, position] of positions.entries()) {
    const last = quotes[index].data?.last;

    if (last === undefined) return null;

    const marked = positionValue(position, last);

    value += marked.value;
    cost += marked.cost;
  }

  return { value, cost, gain: value - cost };
}

/** One currency's unrealized gain over its holdings, with what they are worth and cost and the cash beside them. */
function CurrencyTotals({
  currency,
  positions,
  cash,
}: {
  currency: Currency;
  positions: Position[];
  cash: number | null | undefined;
}) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);
  const direction = useDirectionColors(marketOf(currency));
  const marked = useMarked(positions);
  const tone = marked && directionOf(direction, marked.gain)?.text;

  const details = [
    ...(positions.length > 0 && marked
      ? [
          `${t("account.market-value")} ${format.amount.format(marked.value)}`,
          `${t("account.cost")} ${format.amount.format(marked.cost)}`,
        ]
      : []),
    `${t("account.cash")} ${
      cash === null
        ? t("account.cash-unknown")
        : format.amount.format(cash ?? 0)
    }`,
  ];

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline gap-2">
        <span className="text-xs text-muted">{currency}</span>
        {positions.length === 0 ? null : marked ? (
          <>
            <span className={cn("text-xl font-semibold tabular-nums", tone)}>
              {format.signedAmount.format(marked.gain)}
            </span>
            {marked.cost === 0 ? null : (
              <span className={cn("text-sm tabular-nums", tone)}>
                {format.quotePercentChange.format(marked.gain / marked.cost)}
              </span>
            )}
          </>
        ) : (
          <span className="text-xl font-semibold text-muted">–</span>
        )}
      </div>
      <p className="text-xs text-muted tabular-nums">{details.join(" · ")}</p>
    </div>
  );
}

/** A holding marked at its last price, with a sale or an exit of it a click away. */
function HoldingRow({ position }: { position: Position }) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);

  const symbol = {
    market: position.instrument.market,
    symbol: position.instrument.symbol,
  };

  const shares = sellableOf(position);

  return (
    <li className="flex flex-col gap-1 px-4 py-2.5 text-sm">
      <div className="flex items-baseline gap-3">
        <div className="min-w-0 flex-1">
          <ListingLink symbol={symbol} />
        </div>
        <span className="shrink-0 font-medium tabular-nums">
          <PositionGain symbol={symbol} position={position} />
        </span>
      </div>
      <div className="flex items-baseline gap-3 text-xs text-muted tabular-nums">
        <span className="min-w-0 flex-1 truncate">
          {t("order-form.count.shares", { count: position.quantity })}
          {" · "}
          {t("account.avg-price")} {format.price.format(position.avgPrice)}
          {" · "}
          {t("account.last")} <PositionLast symbol={symbol} />
        </span>
        <span className="shrink-0">
          <PositionReturn symbol={symbol} position={position} />
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-xs text-muted tabular-nums">
          {t("account.exits")} <WatchedExits symbol={symbol} />
        </span>
        <ButtonGroup size="sm" variant="tertiary" className="shrink-0">
          <Button onPress={() => openSale(symbol, shares, TicketTab.Order)}>
            {t("account.sell")}
          </Button>
          <Button onPress={() => openSale(symbol, shares, TicketTab.Exit)}>
            {t("account.set-exit")}
          </Button>
        </ButtonGroup>
      </div>
    </li>
  );
}

/** What the account's closed round trips realized, per currency, with how many and how many won. */
function RealizedTotals() {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);

  const { data, error, refetch } = useQuery(
    orpc.account.roundTrips.queryOptions()
  );

  const records = data && recordsByStance(data);

  return (
    <PaneSection title={t("account.realized")}>
      {error ? (
        <div className="px-4 pb-3">
          <LoadError error={error} onRetry={() => void refetch()} />
        </div>
      ) : !records ? (
        <LoadingState />
      ) : records.length === 0 ? (
        <p className="px-4 pb-3 text-xs text-muted">{t("review.empty")}</p>
      ) : (
        <div className="flex flex-col gap-3 px-4 pb-3">
          {records.map(({ currency, all }) => (
            <RealizedLine
              key={currency}
              currency={currency}
              realized={all.realized}
              trips={data.filter(
                ({ instrument }) => currencyOf(instrument.market) === currency
              )}
              details={[
                `${t("review.trips")} ${all.trips}`,
                `${t("review.win-rate")} ${
                  all.winRate === null
                    ? "–"
                    : format.percent.format(all.winRate)
                }`,
              ].join(" · ")}
            />
          ))}
        </div>
      )}
    </PaneSection>
  );
}

function RealizedLine({
  currency,
  realized,
  trips,
  details,
}: {
  currency: Currency;
  realized: number;
  trips: readonly RoundTrip[];
  details: string;
}) {
  const { i18n } = useTranslation();
  const direction = useDirectionColors(marketOf(currency));

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline gap-2">
        <span className="text-xs text-muted">{currency}</span>
        <span
          className={cn(
            "text-base font-semibold tabular-nums",
            directionOf(direction, realized)?.text
          )}>
          {numberFormats(i18n.language).signedAmount.format(realized)}
        </span>
      </div>
      <p className="text-xs text-muted tabular-nums">{details}</p>
      <RealizedTrend trips={trips} market={marketOf(currency)} />
    </div>
  );
}

/**
 * What the account holds and has made: each currency's unrealized gain beside its cash, every
 * holding marked at its last price, and what closed round trips realized.
 */
export function ProfitLoss() {
  const { t } = useTranslation();

  const { data, error, refetch } = useQuery(
    orpc.account.summary.queryOptions()
  );

  if (error) {
    return (
      <div className="p-4">
        <LoadError error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  if (!data) return <LoadingState />;

  const currencies = Object.values(Currency).filter(
    (currency) =>
      currency in data.cash ||
      data.positions.some(
        ({ instrument }) => currencyOf(instrument.market) === currency
      )
  );

  return (
    <>
      <PaneSection title={t("account.unrealized-gain")}>
        <div className="flex flex-col gap-3 px-4 pb-3">
          {currencies.map((currency) => (
            <CurrencyTotals
              key={currency}
              currency={currency}
              positions={data.positions.filter(
                ({ instrument }) => currencyOf(instrument.market) === currency
              )}
              cash={data.cash[currency]}
            />
          ))}
        </div>
      </PaneSection>
      <PaneSection title={t("account.positions")} count={data.positions.length}>
        {data.positions.length === 0 ? (
          <p className="px-4 pb-3 text-xs text-muted">
            {t("account.no-positions")}
          </p>
        ) : (
          <ul className="divide-y divide-separator">
            {data.positions.map((position) => (
              <HoldingRow
                key={symbolKey(position.instrument)}
                position={position}
              />
            ))}
          </ul>
        )}
      </PaneSection>
      <RealizedTotals />
    </>
  );
}
