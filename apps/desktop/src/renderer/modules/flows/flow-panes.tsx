import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";
import { HistogramSeries, LineSeries } from "lightweight-charts";
import { useTranslation } from "react-i18next";

import { candleDate } from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import { Investor, balanceByBar, netBuyingByBar } from "@solyx/core/flows";
import type { SymbolRef } from "@solyx/core/market";
import { twLots } from "@solyx/core/rules/tw";
import { Series } from "@solyx/trading-chart/series";
import { utcTimestamp } from "@solyx/trading-chart/time-format";

import { ChartIndicator, FLOW_INDICATORS } from "#shared/chart-indicator.ts";

import { LINE_COLORS } from "../market/chart-palette.ts";
import {
  LOWER_PANE_STRETCH,
  lineOptions,
  toHistogram,
  toLine,
} from "../market/chart-series.ts";
import { useIndicatorStore } from "../market/indicator-store.ts";

import { listingFlowsQuery } from "./flows-query.ts";

const lots = (shares: number | null) =>
  shares === null ? null : twLots(shares);

/** Two series' values added bar by bar; a bar neither has stays empty. */
const added = (a: (number | null)[], b: (number | null)[]) =>
  a.map((value, index) =>
    value === null && b[index] === null ? null : (value ?? 0) + (b[index] ?? 0)
  );

/**
 * A Taiwan listing's flows under its chart, bar by bar: each enabled group's net buying in lots as
 * bars about zero, the margin and short balances in lots and foreigners' share of the listing as
 * lines, each in a pane of its own from `firstPane` on. Nothing is read until one is enabled.
 */
export function FlowPanes({
  symbol,
  candles,
  firstPane,
}: {
  symbol: SymbolRef;
  candles: Candle[];
  firstPane: number;
}) {
  const { t } = useTranslation();
  const enabled = useIndicatorStore((state) => state.enabled);

  const { data } = useQuery({
    ...listingFlowsQuery(symbol),
    enabled: FLOW_INDICATORS.some((indicator) => enabled.includes(indicator)),
  });

  const lines = useMemo(() => {
    if (!data) return null;

    const times = candles.map((candle) => utcTimestamp(candle.time));

    const bars = candles.map((candle) =>
      candleDate(symbol.market, candle.time)
    );

    // Neither colour is a price direction's: a bar's side of zero says whether the group bought or sold.
    const net = (investor: Investor, color: string) =>
      toHistogram(
        times,
        netBuyingByBar(data.trades, investor, bars).map(lots),
        color,
        color
      );

    // Dealers hedge the warrants they issue on top of trading for themselves; both are what they bought.
    const dealers = added(
      netBuyingByBar(data.trades, Investor.Dealer, bars),
      netBuyingByBar(data.trades, Investor.DealerHedging, bars)
    ).map(lots);

    return {
      foreign: net(Investor.Foreign, LINE_COLORS.fast),
      trust: net(Investor.InvestmentTrust, LINE_COLORS.slow),
      dealer: toHistogram(
        times,
        dealers,
        LINE_COLORS.dealer,
        LINE_COLORS.dealer
      ),
      margin: toLine(
        times,
        balanceByBar(
          data.margin.map(({ date, margin }) => ({ date, value: margin })),
          bars
        ).map(lots)
      ),
      short: toLine(
        times,
        balanceByBar(
          data.margin.map(({ date, short }) => ({ date, value: short })),
          bars
        ).map(lots)
      ),
      holding: toLine(
        times,
        balanceByBar(
          data.foreign.map(({ date, ratio }) => ({ date, value: ratio * 100 })),
          bars
        )
      ),
    };
  }, [data, candles, symbol.market]);

  const options = useMemo(() => {
    // A pane's title rides its last value on the price scale, since the panes carry no legend.
    const labelled = (title: string) => ({
      title,
      priceFormat: { type: "volume" as const },
      priceLineVisible: false,
      lastValueVisible: true,
    });

    return {
      foreign: labelled(t("chart.flow-titles.foreign-flow")),
      trust: labelled(t("chart.flow-titles.trust-flow")),
      dealer: labelled(t("chart.flow-titles.dealer-flow")),
      margin: {
        ...lineOptions(LINE_COLORS.oscillator),
        ...labelled(t("chart.flow-titles.margin")),
      },
      short: {
        ...lineOptions(LINE_COLORS.short),
        ...labelled(t("chart.flow-titles.short")),
      },
      holding: {
        ...lineOptions(LINE_COLORS.holding),
        ...labelled(t("chart.flow-titles.foreign-holding")),
        priceFormat: { type: "percent" as const },
      },
    };
  }, [t]);

  if (!lines) return null;

  return FLOW_INDICATORS.filter((indicator) => enabled.includes(indicator)).map(
    (indicator, index) => {
      const pane = firstPane + index;

      switch (indicator) {
        case ChartIndicator.ForeignFlow:
          return (
            <Series
              key={indicator}
              definition={HistogramSeries}
              data={lines.foreign}
              options={options.foreign}
              pane={pane}
              paneStretch={LOWER_PANE_STRETCH}
            />
          );
        case ChartIndicator.TrustFlow:
          return (
            <Series
              key={indicator}
              definition={HistogramSeries}
              data={lines.trust}
              options={options.trust}
              pane={pane}
              paneStretch={LOWER_PANE_STRETCH}
            />
          );
        case ChartIndicator.DealerFlow:
          return (
            <Series
              key={indicator}
              definition={HistogramSeries}
              data={lines.dealer}
              options={options.dealer}
              pane={pane}
              paneStretch={LOWER_PANE_STRETCH}
            />
          );
        case ChartIndicator.Short:
          return (
            <Series
              key={indicator}
              definition={LineSeries}
              data={lines.short}
              options={options.short}
              pane={pane}
              paneStretch={LOWER_PANE_STRETCH}
            />
          );
        case ChartIndicator.ForeignHolding:
          return (
            <Series
              key={indicator}
              definition={LineSeries}
              data={lines.holding}
              options={options.holding}
              pane={pane}
              paneStretch={LOWER_PANE_STRETCH}
            />
          );
        default:
          return (
            <Series
              key={indicator}
              definition={LineSeries}
              data={lines.margin}
              options={options.margin}
              pane={pane}
              paneStretch={LOWER_PANE_STRETCH}
            />
          );
      }
    }
  );
}
