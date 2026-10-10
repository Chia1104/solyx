import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Investor, balanceTrend } from "@solyx/core/flows";
import type { Market } from "@solyx/core/market";
import { TW_BOARD_LOT } from "@solyx/core/rules/tw";

import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { numberFormats } from "../market/number-formats.ts";

import { NetBuyingTable, TrendTable } from "./flow-tables.tsx";
import type { TrendRow } from "./flow-tables.tsx";
import { marketFlowsQuery } from "./flows-query.ts";

const lots = (shares: number) => Math.round(shares / TW_BOARD_LOT);

/** Who traded a whole market after each session: net buying, margin, and positions in its index future. */
export function MarketFlows({ market }: { market: Market }) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);
  const { data, error, refetch } = useQuery(marketFlowsQuery(market));

  if (error) return <LoadError error={error} onRetry={() => void refetch()} />;

  if (!data) return <LoadingState />;

  const signedAmount = (amount: number) =>
    format.signedCompactAmount.format(amount);

  const newestMargin = data.margin.at(-1);

  const lending = balanceTrend(
    data.margin.map(({ date, marginValue }) => ({ date, value: marginValue }))
  );

  const short = balanceTrend(
    data.margin.map(({ date, short }) => ({ date, value: short }))
  );

  const balances: TrendRow[] = [];

  if (lending) {
    balances.push({
      id: "lending",
      label: t("flows.margin-lending"),
      trend: lending,
      value: (amount) => format.compactAmount.format(amount),
      change: signedAmount,
    });
  }

  if (short && newestMargin) {
    balances.push({
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
      value: (shares) => format.indicator.format(lots(shares)),
      change: (shares) => format.signedAmount.format(lots(shares)),
    });
  }

  const positions = Object.values(Investor).flatMap((investor): TrendRow[] => {
    const trend = balanceTrend(
      data.futures
        .filter((position) => position.investor === investor)
        .map(({ date, long, short }) => ({ date, value: long - short }))
    );

    return trend
      ? [
          {
            id: investor,
            label: t(`flows.investors.${investor}`),
            trend,
            value: (contracts) => format.signedAmount.format(contracts),
            change: (contracts) => format.signedAmount.format(contracts),
          },
        ]
      : [];
  });

  if (
    data.trades.length === 0 &&
    balances.length === 0 &&
    positions.length === 0
  ) {
    return (
      <p className="rounded-sm pencil px-3 py-3 text-xs text-muted">
        {t("flows.market-empty")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <NetBuyingTable
          title={t("flows.net-value")}
          trades={data.trades}
          format={signedAmount}
        />
        {data.trades.some(
          ({ investor }) => investor === Investor.DealerHedging
        ) ? (
          <p className="text-xs text-muted">{t("flows.hedging-note")}</p>
        ) : null}
      </div>
      <TrendTable
        title={t("flows.balances")}
        label={t("flows.item")}
        rows={balances}
      />
      <TrendTable
        title={t("flows.futures")}
        label={t("flows.investor")}
        rows={positions}
      />
    </div>
  );
}
