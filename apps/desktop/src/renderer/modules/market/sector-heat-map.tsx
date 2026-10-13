import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Market } from "@solyx/core/market";
import { SectorGroup, sectorMoves } from "@solyx/core/sectors";

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

  const moves = new Map(sectorMoves(data).map((move) => [move.sector, move]));

  // Before the first trade every sector shares the room equally.
  const traded = [...moves.values()].some((move) => move.share > 0);

  return (
    <HeatMap
      height={HEIGHT}
      groups={Object.values(SectorGroup).map((group) => ({
        id: group,
        label: t(`sectors.groups.${group}`),
        tiles: data
          .filter((sector) => sector.group === group)
          .map(({ sector }) => {
            const move = moves.get(sector);

            return {
              id: sector,
              label: t(`sectors.names.${sector}`),
              value: move
                ? format.quotePercentChange.format(move.percent)
                : "—",
              weight: traded ? (move?.share ?? 0) : 1,
              color: move && directionOf(direction, move.change)?.solid,
              strength: move
                ? Math.min(Math.abs(move.percent) / FULL_COLOUR_MOVE, 1)
                : 0,
              figures: move && [
                {
                  label: t("heat-map.sectors.figures.index"),
                  value: format.quotePrice.format(move.quote.last),
                },
                {
                  label: t("heat-map.sectors.figures.change"),
                  value: format.quoteChange.format(move.change),
                },
                {
                  label: t("heat-map.sectors.figures.value"),
                  value: format.compactAmount.format(move.quote.tradeValue),
                },
                {
                  label: t("heat-map.sectors.figures.share"),
                  value: format.fineShare.format(move.share),
                },
              ],
            };
          }),
      }))}
    />
  );
}
