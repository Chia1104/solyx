import { useTranslation } from "react-i18next";

import { symbolKey } from "@solyx/core/market";
import type { Market } from "@solyx/core/market";
import { SECTOR_GROUPS, SECTOR_INDICES } from "@solyx/core/sectors";

import { ListingsRotation } from "./listings-rotation.tsx";
import { GROUP_COLORS } from "./sector-rotation.tsx";

/**
 * A market's sector funds on a relative rotation graph against its index, read as listings on
 * adjusted bars, since a fund pays out what its holdings do.
 */
export function SectorFundRotation({ market }: { market: Market }) {
  const { t } = useTranslation();
  const funds = SECTOR_INDICES[market];

  const fundOf = new Map(
    funds.map((fund) => [symbolKey({ market, symbol: fund.symbol }), fund])
  );

  return (
    <ListingsRotation
      market={market}
      symbols={funds.map(({ symbol }) => ({ market, symbol }))}
      entry={({ symbol, paths }) => {
        const fund = fundOf.get(symbolKey(symbol));

        if (!fund) return null;

        const name = t(`sectors.names.${fund.sector}`);

        return {
          id: fund.symbol,
          name,
          title: (
            <>
              {name}{" "}
              <span className="font-normal text-muted">{fund.symbol}</span>
            </>
          ),
          group: fund.group,
          paths,
          symbol,
        };
      }}
      groups={SECTOR_GROUPS[market].map((group) => ({
        id: group,
        label: t(`sectors.groups.${group}`),
        color: GROUP_COLORS[group],
      }))}
    />
  );
}
