import { useQueries, useQuery } from "@tanstack/react-query";
import { sum, uniq } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { inTwd } from "@solyx/core/exchange-rate";
import { Market, currencyOf, symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { quoteChange } from "@solyx/core/quote";

import { HeatMap } from "../../components/heat-map.tsx";
import { exchangeRateQuery } from "../macro/macro-query.ts";

import { useListingNames } from "./listing-name.tsx";
import { numberFormats } from "./number-formats.ts";
import { useDirectionColors } from "./price-colors.ts";
import { directionOf } from "./quote-figures.tsx";
import { quoteQuery } from "./quote-query.ts";

/** A move this large in either direction takes the full colour. */
const FULL_COLOUR_MOVE = 0.05;

export interface QuoteHeatMapGroup {
  id: string;
  label: string;
  tiles: {
    symbol: SymbolRef;
    /** Shares held, which size the tile by market value, in Taiwan dollars where its group holds both currencies; tiles without share their group equally. */
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

  /** Whether a group's tiles are priced in more than one currency, so their values must be put in one. */
  const mixed = (group: QuoteHeatMapGroup) =>
    uniq(group.tiles.map(({ symbol }) => currencyOf(symbol.market))).length > 1;

  const rate = useQuery({
    ...exchangeRateQuery(),
    enabled: groups.some(mixed),
  }).data;

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
        const inOne = mixed(group);

        const tiles = group.tiles.map((tile) => {
          const quote = quoteOf.get(symbolKey(tile.symbol));
          const moved = quote ? quoteChange(quote) : null;

          const worth =
            tile.shares === undefined || !quote
              ? null
              : tile.shares * quote.last;

          return {
            symbol: tile.symbol,
            name: nameOf.get(symbolKey(tile.symbol)),
            moved,
            value:
              worth === null || !inOne
                ? worth
                : rate
                  ? inTwd(worth, currencyOf(tile.symbol.market), rate)
                  : null,
          };
        });

        // Equal shares until every price that weighs them, and the rate between them, has arrived.
        const total = tiles.every(({ value }) => value !== null)
          ? sum(tiles.map(({ value }) => value ?? 0))
          : 0;

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
            weight: total > 0 ? ((value ?? 0) / total) * tiles.length : 1,
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
