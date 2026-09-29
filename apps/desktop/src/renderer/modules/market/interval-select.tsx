import { ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { Interval } from "@solyx/core/candles";
import { isEnumValue } from "@solyx/utils/is";

export function IntervalSelect({
  value,
  onChange,
}: {
  value: Interval;
  onChange: (interval: Interval) => void;
}) {
  const { t } = useTranslation();

  return (
    <ToggleButtonGroup
      aria-label={t("chart.intervals-label")}
      selectionMode="single"
      disallowEmptySelection
      size="sm"
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const [next] = keys;

        if (next !== undefined && isEnumValue(Interval, next)) onChange(next);
      }}>
      {Object.values(Interval).map((interval) => (
        <ToggleButton key={interval} id={interval}>
          {t(`chart.intervals.${interval}`)}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
