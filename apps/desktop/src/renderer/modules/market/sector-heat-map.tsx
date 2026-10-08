import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Market } from "@solyx/core/market";
import { SectorGroup } from "@solyx/core/sectors";

import { HeatMap } from "../../components/heat-map.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";

import { numberFormats } from "./number-formats.ts";
import { useDirectionColors } from "./price-colors.ts";
import { directionOf } from "./quote-figures.tsx";
import { sectorsQuery } from "./quote-query.ts";

/** Sector indices move less than single listings, so the colour fills sooner. */
const FULL_COLOUR_MOVE = 0.03;

/** Taller than a list's map, since a few sectors trade most of the value and the rest share little room. */
const HEIGHT = 320;

/** Taiwan's listed sectors, sized by value traded today and coloured by their index's move. */
export function SectorHeatMap() {
  const { t, i18n } = useTranslation();
  const { data, error, refetch } = useQuery(sectorsQuery());
  const direction = useDirectionColors(Market.TW);
  const format = numberFormats(i18n.language);

  if (error) return <LoadError error={error} onRetry={() => void refetch()} />;

  if (data === undefined) return <LoadingState />;

  if (data === null) {
    return (
      <p className="text-sm text-muted">{t("heat-map.sectors.unavailable")}</p>
    );
  }

  // Before the first trade every sector shares the room equally.
  const traded = data.some((sector) => (sector.quote?.tradeValue ?? 0) > 0);

  return (
    <HeatMap
      height={HEIGHT}
      groups={Object.values(SectorGroup).map((group) => ({
        id: group,
        label: t(`sectors.groups.${group}`),
        tiles: data
          .filter((sector) => sector.group === group)
          .map(({ sector, quote }) => {
            const change = quote ? quote.last - quote.reference : null;

            const percent =
              quote && change !== null ? change / quote.reference : null;

            return {
              id: sector,
              label: t(`sectors.names.${sector}`),
              value:
                percent === null
                  ? "—"
                  : format.quotePercentChange.format(percent),
              weight: traded ? (quote?.tradeValue ?? 0) : 1,
              color:
                change === null
                  ? undefined
                  : directionOf(direction, change)?.solid,
              strength:
                percent === null
                  ? 0
                  : Math.min(Math.abs(percent) / FULL_COLOUR_MOVE, 1),
            };
          }),
      }))}
    />
  );
}
