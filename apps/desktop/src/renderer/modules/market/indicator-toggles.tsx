import { ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { ChartIndicator, useIndicatorStore } from "./indicator-store.ts";

export function IndicatorToggles() {
  const { t } = useTranslation();
  const enabled = useIndicatorStore((state) => state.enabled);
  const setEnabled = useIndicatorStore((state) => state.setEnabled);

  return (
    <ToggleButtonGroup
      aria-label={t("chart.indicators-label")}
      selectionMode="multiple"
      size="sm"
      isDetached
      selectedKeys={enabled}
      onSelectionChange={(keys) =>
        setEnabled(Object.values(ChartIndicator).filter((key) => keys.has(key)))
      }>
      {Object.values(ChartIndicator).map((indicator) => (
        <ToggleButton key={indicator} id={indicator}>
          {t(`chart.indicators.${indicator}`)}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
