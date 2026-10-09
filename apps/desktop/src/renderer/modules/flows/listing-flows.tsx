import type { ReactNode } from "react";

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Investor, balanceTrend } from "@solyx/core/flows";
import type { ListingFlows } from "@solyx/core/flows";
import type { SymbolRef } from "@solyx/core/market";
import { TW_BOARD_LOT } from "@solyx/core/rules/tw";

import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { numberFormats } from "../market/number-formats.ts";

import { NetBuyingTable, TrendTable } from "./flow-tables.tsx";
import type { TrendRow } from "./flow-tables.tsx";
import { listingFlowsQuery } from "./flows-query.ts";

const lots = (shares: number) => Math.round(shares / TW_BOARD_LOT);

function ListingFlowsView({ flows }: { flows: ListingFlows }) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);

  const signedLots = (shares: number) =>
    format.signedAmount.format(lots(shares));

  const plainLots = (shares: number) => format.indicator.format(lots(shares));

  const newestMargin = flows.margin.at(-1);
  const holding = flows.foreign.at(-1);

  const margin = balanceTrend(
    flows.margin.map(({ date, margin }) => ({ date, value: margin }))
  );

  const short = balanceTrend(
    flows.margin.map(({ date, short }) => ({ date, value: short }))
  );

  const foreign = balanceTrend(
    flows.foreign.map(({ date, ratio }) => ({ date, value: ratio * 100 }))
  );

  const rows: TrendRow[] = [];

  if (margin && newestMargin) {
    rows.push({
      id: "margin",
      label: t("flows.margin-lots"),
      detail:
        newestMargin.marginLimit > 0
          ? t("flows.of-limit", {
              share: format.fineShare.format(
                newestMargin.margin / newestMargin.marginLimit
              ),
            })
          : undefined,
      trend: margin,
      value: plainLots,
      change: signedLots,
    });
  }

  if (short && newestMargin) {
    rows.push({
      id: "short",
      label: t("flows.short-lots"),
      detail:
        newestMargin.margin > 0
          ? t("flows.short-to-margin", {
              share: format.fineShare.format(
                newestMargin.short / newestMargin.margin
              ),
            })
          : undefined,
      trend: short,
      value: plainLots,
      change: signedLots,
    });
  }

  if (foreign && holding) {
    rows.push({
      id: "foreign",
      label: t("flows.foreign-holding"),
      detail: t("flows.holding-limit", {
        share: format.fineShare.format(holding.limit),
      }),
      trend: foreign,
      value: (percent) => format.indicator.format(percent),
      change: (points) => format.signedAmount.format(points),
    });
  }

  if (flows.trades.length === 0 && rows.length === 0) {
    return (
      <p className="px-6 py-4 text-sm text-muted">{t("flows.listing-empty")}</p>
    );
  }

  return (
    // Side by side where the main view is wide; narrower, the balances follow the net buying.
    <div className="grid gap-6 px-6 py-4 @min-[56rem]/main:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <NetBuyingTable
          title={t("flows.net-lots")}
          trades={flows.trades}
          format={signedLots}
        />
        {flows.trades.some(
          ({ investor }) => investor === Investor.DealerHedging
        ) ? (
          <p className="text-xs text-muted">{t("flows.hedging-note")}</p>
        ) : null}
      </div>
      <TrendTable
        title={t("flows.balances")}
        label={t("flows.item")}
        rows={rows}
      />
    </div>
  );
}

/**
 * Who traded a Taiwan listing after each session: each investor group's net buying, its margin
 * and short balances and foreign investors' holding, filling the height it is given.
 */
export function ListingFlowsPanel({
  symbol,
  heading,
}: {
  symbol: SymbolRef;
  /** What leads the header row, such as the switch between this and the news. */
  heading: ReactNode;
}) {
  const { t } = useTranslation();
  const { data, error, refetch } = useQuery(listingFlowsQuery(symbol));

  let body = <LoadingState />;

  if (error) {
    body = (
      <div className="px-6 py-4">
        <LoadError error={error} onRetry={() => void refetch()} />
      </div>
    );
  } else if (data) {
    body = <ListingFlowsView flows={data} />;
  }

  return (
    <section
      aria-label={t("flows.title")}
      className="flex h-full flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-separator px-6">
        {heading}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </section>
  );
}
