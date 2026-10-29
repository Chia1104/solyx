import { useId, useState } from "react";

import { ToggleButton, ToggleButtonGroup, Tooltip, cn } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { Market } from "@solyx/core/market";
import { isEnumValue } from "@solyx/utils/is";

import { PositionList } from "../modules/account/position-list.tsx";
import { Watchlist } from "../modules/watchlist/watchlist.tsx";

import { useLayoutStore } from "./layout-store.ts";

const TOOLTIP_DELAY = 600;

// The category that leaves every market in, `null` in the layout store.
const EVERY_MARKET = "all";

/** The categories in the order their dots lie: every market, then each market alone. */
const CATEGORIES: (Market | null)[] = [null, ...Object.values(Market)];

function useCategoryName() {
  const { t } = useTranslation();

  return (market: Market | null) =>
    market === null ? t("market-filter.every") : t(`market.${market}`);
}

/**
 * The lists the user follows and holds in the category picked, under its name. A category picked
 * slides in from the side its dot lies on.
 */
export function CategoryLists() {
  const { t } = useTranslation();
  const name = useCategoryName();
  const watchlistId = useId();
  const positionsId = useId();
  const market = useLayoutStore((state) => state.symbolsMarket);

  const index = CATEGORIES.indexOf(market);
  const [last, setLast] = useState(index);
  const [forward, setForward] = useState<boolean | null>(null);

  if (index !== last) {
    setLast(index);
    setForward(index > last);
  }

  return (
    <div
      key={market ?? EVERY_MARKET}
      className={cn(
        "flex min-h-0 flex-1 flex-col pt-4",
        forward !== null &&
          cn(
            forward
              ? "animate-[category-in-from-end_200ms_var(--ease-out-quint)]"
              : "animate-[category-in-from-start_200ms_var(--ease-out-quint)]",
            "motion-reduce:animate-[fade-in_200ms_var(--ease-out-quint)]"
          )
      )}>
      <h2 className="shrink-0 px-4 text-sm font-semibold text-muted">
        {name(market)}
      </h2>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-3">
        <section aria-labelledby={watchlistId} className="flex flex-col gap-1">
          <h3 id={watchlistId} className="px-4 text-xs font-medium text-muted">
            {t("watchlist.title")}
          </h3>
          <Watchlist market={market} />
        </section>
        <section aria-labelledby={positionsId} className="flex flex-col gap-1">
          <h3 id={positionsId} className="px-4 text-xs font-medium text-muted">
            {t("account.positions")}
          </h3>
          <PositionList market={market} />
        </section>
      </div>
    </div>
  );
}

/** Picks the category the lists keep to, a dot each and the one shown inked; its name heads the lists. */
export function CategoryDots() {
  const { t } = useTranslation();
  const name = useCategoryName();
  const market = useLayoutStore((state) => state.symbolsMarket);
  const setMarket = useLayoutStore((state) => state.setSymbolsMarket);

  return (
    <ToggleButtonGroup
      isDetached
      aria-label={t("workspace.categories")}
      selectionMode="single"
      disallowEmptySelection
      size="sm"
      selectedKeys={[market ?? EVERY_MARKET]}
      onSelectionChange={(keys) => {
        const [key] = keys;

        setMarket(isEnumValue(Market, key) ? key : null);
      }}>
      {CATEGORIES.map((each) => (
        <Tooltip key={each ?? EVERY_MARKET} delay={TOOLTIP_DELAY}>
          <ToggleButton
            isIconOnly
            variant="ghost"
            id={each ?? EVERY_MARKET}
            aria-label={name(each)}
            className="text-muted data-selected:bg-transparent data-selected:text-foreground">
            <span aria-hidden className="size-1.5 rounded-full bg-current" />
          </ToggleButton>
          <Tooltip.Content>{name(each)}</Tooltip.Content>
        </Tooltip>
      ))}
    </ToggleButtonGroup>
  );
}
