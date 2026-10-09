import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";
import { HistogramSeries, LineSeries } from "lightweight-charts";
import { useTranslation } from "react-i18next";

import { candleDate } from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import { Investor, balanceByBar, netBuyingByBar } from "@solyx/core/flows";
import type { SymbolRef } from "@solyx/core/market";
import { TW_BOARD_LOT } from "@solyx/core/rules/tw";
import { Series } from "@solyx/trading-chart/series";
import { utcTimestamp } from "@solyx/trading-chart/time-format";

import { LINE_COLORS } from "../market/chart-palette.ts";
import {
  LOWER_PANE_STRETCH,
  lineOptions,
  toHistogram,
  toLine,
} from "../market/chart-series.ts";
import {
  ChartIndicator,
  FLOW_INDICATORS,
  useIndicatorStore,
} from "../market/indicator-store.ts";

import { listingFlowsQuery } from "./flows-query.ts";

const lots = (shares: number | null) =>
  shares === null ? null : Math.round(shares / TW_BOARD_LOT);

/**
 * A Taiwan listing's flows under its chart, in lots and bar by bar: each enabled group's net
 * buying as bars about zero, and the margin balance as a line, each in a pane of its own from
 * `firstPane` on. Nothing is read until one is enabled.
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

    return {
      foreign: net(Investor.Foreign, LINE_COLORS.fast),
      trust: net(Investor.InvestmentTrust, LINE_COLORS.slow),
      margin: toLine(
        times,
        balanceByBar(
          data.margin.map(({ date, margin }) => ({ date, value: margin })),
          bars
        ).map(lots)
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
      margin: {
        ...lineOptions(LINE_COLORS.oscillator),
        ...labelled(t("chart.flow-titles.margin")),
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
