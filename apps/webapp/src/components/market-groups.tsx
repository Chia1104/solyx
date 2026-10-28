import { Fragment } from "react";
import type { ReactNode } from "react";

import { useTranslation } from "react-i18next";

import { Market } from "@solyx/core/market";

import { PaneSection } from "./pane-section.tsx";

export interface MarketGroup<T> {
  market: Market;
  items: T[];
}

/** `items` by market, only `market`'s where one is picked; a market with none is left out. */
export function groupByMarket<T>(
  items: readonly T[],
  marketOf: (item: T) => Market,
  market: Market | null
): MarketGroup<T>[] {
  return (market ? [market] : Object.values(Market)).flatMap((each) => {
    const found = items.filter((item) => marketOf(item) === each);

    return found.length > 0 ? [{ market: each, items: found }] : [];
  });
}

/** A side pane's rows of each market, under the market's heading once there are more than one. */
export function MarketGroups<T>({
  groups,
  children,
}: {
  groups: readonly MarketGroup<T>[];
  children: (group: MarketGroup<T>) => ReactNode;
}) {
  const { t } = useTranslation();

  return groups.map((group) =>
    groups.length > 1 ? (
      <PaneSection
        key={group.market}
        title={t(`market.${group.market}`)}
        count={group.items.length}>
        {children(group)}
      </PaneSection>
    ) : (
      <Fragment key={group.market}>{children(group)}</Fragment>
    )
  );
}
