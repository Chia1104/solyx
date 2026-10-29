import { ToggleButton, ToggleButtonGroup, cn } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { Market } from "@solyx/core/market";
import { isEnumValue } from "@solyx/utils/is";

import { SEGMENT, SEGMENT_TRACK } from "./segment.ts";

// The choice that leaves every market in.
const EVERY_MARKET = "all";

// Each choice on the track as a tab is, the one picked lifted on the segment's ground.
const CHOICE = cn(
  SEGMENT,
  "text-muted data-selected:bg-segment data-selected:text-foreground data-selected:shadow-surface"
);

/**
 * Which market a list keeps to, `null` for every market. Without `every` there is no such
 * choice, so `onChange` is only ever given a market.
 */
export function MarketFilter({
  value,
  onChange,
  every = true,
  className,
}: {
  value: Market | null;
  onChange: (market: Market | null) => void;
  /** @default true */
  every?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <ToggleButtonGroup
      aria-label={t("market-filter.label")}
      selectionMode="single"
      disallowEmptySelection
      size="sm"
      isDetached
      className={cn(SEGMENT_TRACK, "gap-0", className)}
      selectedKeys={[value ?? EVERY_MARKET]}
      onSelectionChange={(keys) => {
        const [key] = keys;

        onChange(isEnumValue(Market, key) ? key : null);
      }}>
      {every ? (
        <ToggleButton id={EVERY_MARKET} variant="ghost" className={CHOICE}>
          {t("market-filter.every")}
        </ToggleButton>
      ) : null}
      {Object.values(Market).map((each) => (
        <ToggleButton key={each} id={each} variant="ghost" className={CHOICE}>
          {t(`market.${each}`)}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
