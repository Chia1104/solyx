import { ChartAverageIcon } from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";

import { ToggleMenu } from "../../components/toggle-menu.tsx";

import { ChartIndicator, useIndicatorStore } from "./indicator-store.ts";

export function IndicatorMenu() {
  const { t } = useTranslation();
  const enabled = useIndicatorStore((state) => state.enabled);
  const setEnabled = useIndicatorStore((state) => state.setEnabled);

  return (
    <ToggleMenu
      label={t("chart.indicators-label")}
      icon={ChartAverageIcon}
      options={Object.values(ChartIndicator).map((indicator) => ({
        id: indicator,
        label: t(`chart.indicators.${indicator}`),
      }))}
      selected={enabled}
      onChange={setEnabled}
    />
  );
}
