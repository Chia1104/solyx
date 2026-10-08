import { useQueries } from "@tanstack/react-query";
import { sum } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { Market, symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import { HeatMap } from "../../components/heat-map.tsx";

import { useListingNames } from "./listing-name.tsx";
import { numberFormats } from "./number-formats.ts";
import { useDirectionColors } from "./price-colors.ts";
import { directionOf, quoteChange } from "./quote-figures.tsx";
import { quoteQuery } from "./quote-query.ts";

/** A move this large in either direction takes the full colour. */
const FULL_COLOUR_MOVE = 0.05;

export interface QuoteHeatMapGroup {
  id: string;
  label: string;
  tiles: {
    symbol: SymbolRef;
    /** Shares held, which size the tile by market value; tiles without share their group equally. */
    shares?: number;
  }[];
}

/** Listings coloured by today's move. Each group takes room by its number of tiles. */
export function QuoteHeatMap({ groups }: { groups: QuoteHeatMapGroup[] }) {
  const { i18n } = useTranslation();
  const format = numberFormats(i18n.language);

  const directions = {
    [Market.TW]: useDirectionColors(Market.TW),
    [Market.US]: useDirectionColors(Market.US),
  };

  const symbols = groups.flatMap((group) =>
    group.tiles.map((tile) => tile.symbol)
  );

  const quotes = useQueries({
    queries: symbols.map((symbol) => quoteQuery(symbol)),
  });

  const names = useListingNames(symbols);

  const quoteOf = new Map(
    symbols.map((symbol, index) => [symbolKey(symbol), quotes[index].data])
  );

  const nameOf = new Map(
    symbols.map((symbol, index) => [symbolKey(symbol), names[index]])
  );

  return (
    <HeatMap
      groups={groups.map((group) => {
        const tiles = group.tiles.map((tile) => {
          const quote = quoteOf.get(symbolKey(tile.symbol));
          const moved = quote ? quoteChange(quote) : null;

          return {
            symbol: tile.symbol,
            name: nameOf.get(symbolKey(tile.symbol)),
            moved,
            value:
              tile.shares === undefined ? 1 : tile.shares * (quote?.last ?? 0),
          };
        });

        const total = sum(tiles.map((tile) => tile.value));

        return {
          id: group.id,
          label: group.label,
          tiles: tiles.map(({ symbol, name, moved, value }) => ({
            id: symbolKey(symbol),
            symbol,
            label: symbol.symbol,
            name,
            value: moved
              ? format.quotePercentChange.format(moved.percent)
              : "—",
            // Equal shares until the prices that weigh them arrive.
            weight: total > 0 ? (value / total) * tiles.length : 1,
            color: moved
              ? directionOf(directions[symbol.market], moved.change)?.solid
              : undefined,
            strength: moved
              ? Math.min(Math.abs(moved.percent) / FULL_COLOUR_MOVE, 1)
              : 0,
          })),
        };
      })}
    />
  );
}
