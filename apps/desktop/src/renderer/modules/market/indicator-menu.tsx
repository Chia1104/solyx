import { ChartAverageIcon } from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";

import type { Interval } from "@solyx/core/candles";
import type { Market } from "@solyx/core/market";

import { offeredIndicators } from "#shared/chart-indicator.ts";

import { ToggleMenu } from "../../components/toggle-menu.tsx";

import { useIndicatorStore } from "./indicator-store.ts";

/**
 * The chart's indicators for a listing of `market` on bars of `interval`; one it cannot draw
 * stays as the user left it.
 */
export function IndicatorMenu({
  market,
  interval,
}: {
  market: Market;
  interval: Interval;
}) {
  const { t } = useTranslation();
  const enabled = useIndicatorStore((state) => state.enabled);
  const setEnabled = useIndicatorStore((state) => state.setEnabled);

  const offered = offeredIndicators(market, interval);

  return (
    <ToggleMenu
      label={t("chart.indicators-label")}
      icon={ChartAverageIcon}
      options={offered.map((indicator) => ({
        id: indicator,
        label: t(`chart.indicators.${indicator}`),
      }))}
      selected={enabled.filter((indicator) => offered.includes(indicator))}
      onChange={(next) =>
        setEnabled([
          ...next,
          ...enabled.filter((indicator) => !offered.includes(indicator)),
        ])
      }
    />
  );
}
