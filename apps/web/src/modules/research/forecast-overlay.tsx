import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";
import { LineSeries, LineStyle } from "lightweight-charts";
import type {
  CreatePriceLineOptions,
  LineSeriesPartialOptions,
  SeriesMarker,
  Time,
} from "lightweight-charts";
import { useTranslation } from "react-i18next";

import type { Candle } from "@solyx/core/candles";
import { ForecastDirection, forecastTimeline } from "@solyx/core/forecast";
import type { Forecast } from "@solyx/core/forecast";
import type { SymbolRef } from "@solyx/core/market";
import { Series } from "@solyx/trading-chart/series";
import { utcTimestamp } from "@solyx/trading-chart/time-format";

import { usePaletteColors } from "../../app/theme.ts";
import { faded } from "../market/chart-palette.ts";

import { researchCoverageQuery } from "./research-query.ts";

// The least likely path still reads; the likeliest is drawn in full ink.
const FAINTEST = 0.3;

const DIRECTION_MARKS: Record<ForecastDirection, SeriesMarker<Time>["shape"]> =
  {
    [ForecastDirection.Long]: "arrowUp",
    [ForecastDirection.Short]: "arrowDown",
    [ForecastDirection.Neutral]: "circle",
  };

function ForecastPaths({
  forecast,
  candles,
}: {
  forecast: Forecast;
  candles: Candle[];
}) {
  const { t } = useTranslation();
  const colors = usePaletteColors();

  // Dashed and in ink, never red or green: a path is a claim, not a price that traded.
  const options = useMemo(
    () =>
      forecast.scenarios.map((scenario): LineSeriesPartialOptions => ({
        color: faded(
          colors.foreground,
          FAINTEST + (1 - FAINTEST) * (scenario.probability / 100)
        ),
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        title: `${scenario.label} ${scenario.probability}%`,
      })),
    [forecast, colors]
  );

  const paths = useMemo(() => {
    const timeline = forecastTimeline(forecast, candles);

    if (timeline.length === 0) return [];

    return forecast.scenarios.map((scenario) => [
      { time: utcTimestamp(timeline[0]), value: forecast.anchor.price },
      ...scenario.path.map((point) => ({
        time: utcTimestamp(timeline[point.session]),
        value: point.price,
      })),
    ]);
  }, [forecast, candles]);

  const levels = useMemo(() => {
    const { plan } = forecast;

    if (!plan) return undefined;

    const level = (price: number, title: string): CreatePriceLineOptions => ({
      price,
      title,
      color: colors.muted,
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: true,
    });

    return [
      level(plan.entry, t("research.forecast.entry")),
      level(plan.stop, t("research.forecast.stop")),
      level(plan.target, t("research.forecast.target")),
    ];
  }, [forecast, colors, t]);

  // The paths fan out from the anchor, so its mark says which way the forecast went and, once
  // settled, how it came out.
  const markers = useMemo(() => {
    const anchor = paths[0]?.[0];

    if (!anchor) return undefined;

    const { direction, outcome, scenarios } = forecast;
    const label = t(`research.direction.${direction}`);

    let result: string | null = null;

    if (outcome?.plan) {
      result = t(`research.forecast.plan-result.${outcome.plan.result}`);
    } else if (outcome) {
      result = `${scenarios[outcome.scenario].label} ${t("research.forecast.held")}`;
    }

    return [
      {
        time: anchor.time,
        position: "inBar",
        // Lightweight Charts' own field; a computed key keeps it apart from the names we choose.
        ["shape"]: DIRECTION_MARKS[direction],
        color: colors.foreground,
        text: result ? `${label} · ${result}` : label,
      },
    ] satisfies SeriesMarker<Time>[];
  }, [forecast, paths, colors, t]);

  return paths.map((data, index) => (
    <Series
      key={forecast.scenarios[index].label}
      definition={LineSeries}
      data={data}
      options={options[index]}
      priceLines={index === 0 ? levels : undefined}
      markers={index === 0 ? markers : undefined}
    />
  ));
}

/**
 * A listing's newest forecast over its daily bars: each scenario's path from the anchor, fainter
 * the less likely, a mark at the anchor with its direction and outcome, and the plan's levels. Bars that trade later draw over the paths, which stay
 * as they were made.
 */
export function ForecastOverlay({
  symbol,
  candles,
}: {
  symbol: SymbolRef;
  candles: Candle[];
}) {
  const { data } = useQuery(researchCoverageQuery(symbol));
  const forecast = data?.forecasts.at(-1);

  return forecast ? (
    <ForecastPaths forecast={forecast} candles={candles} />
  ) : null;
}
