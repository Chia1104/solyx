import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Market } from "@solyx/core/market";
import { SECTOR_GROUPS, sectorMoves } from "@solyx/core/sectors";
import type { SectorQuote } from "@solyx/core/sectors";

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

/** One read of a market's sectors, sized by value traded and coloured by their index's or fund's move. */
export function SectorMap({
  market,
  sectors,
  height = HEIGHT,
}: {
  market: Market;
  sectors: readonly SectorQuote[];
  height?: number;
}) {
  const { t, i18n } = useTranslation();
  const direction = useDirectionColors(market);
  const format = numberFormats(i18n.language);

  const moves = new Map(
    sectorMoves(sectors).map((move) => [move.sector, move])
  );

  // Before the first trade every sector shares the room equally.
  const traded = [...moves.values()].some((move) => move.share > 0);

  return (
    <HeatMap
      height={height}
      groups={SECTOR_GROUPS[market].map((group) => ({
        id: group,
        label: t(`sectors.groups.${group}`),
        tiles: sectors
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
                  label: t(
                    market === Market.TW
                      ? "heat-map.sectors.figures.index"
                      : "heat-map.sectors.figures.fund"
                  ),
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

/** A market's sectors as they trade today, which `followQuotes` keeps up with the session. */
export function SectorHeatMap({ market }: { market: Market }) {
  const { t } = useTranslation();
  const { data, error, refetch } = useQuery(sectorsQuery(market));

  if (error) return <LoadError error={error} onRetry={() => void refetch()} />;

  if (data === undefined) return <LoadingState />;

  if (data === null) {
    return (
      <p className="text-sm text-muted">{t("heat-map.sectors.unavailable")}</p>
    );
  }

  return <SectorMap market={market} sectors={data} />;
}
