import { ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { Market } from "@solyx/core/market";
import { isEnumValue } from "@solyx/utils/is";

// The choice that leaves every market in.
const EVERY_MARKET = "all";

/**
 * Which market a list keeps to, `null` for every market. Without `every` there is no such
 * choice, so `onChange` is only ever given a market.
 */
export function MarketFilter({
  value,
  onChange,
  every = true,
  fullWidth,
  className,
}: {
  value: Market | null;
  onChange: (market: Market | null) => void;
  /** @default true */
  every?: boolean;
  fullWidth?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <ToggleButtonGroup
      aria-label={t("market-filter.label")}
      selectionMode="single"
      disallowEmptySelection
      size="sm"
      fullWidth={fullWidth}
      className={className}
      selectedKeys={[value ?? EVERY_MARKET]}
      onSelectionChange={(keys) => {
        const [key] = keys;

        onChange(isEnumValue(Market, key) ? key : null);
      }}>
      {every ? (
        <ToggleButton id={EVERY_MARKET} variant="ghost">
          {t("market-filter.every")}
        </ToggleButton>
      ) : null}
      {Object.values(Market).map((each) => (
        <ToggleButton key={each} id={each} variant="ghost">
          {t(`market.${each}`)}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
