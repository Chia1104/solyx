import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { useTranslation } from "react-i18next";

import type { Candle } from "@solyx/core/candles";

import { percent, price } from "./format.ts";
import { sessionChange } from "./listings.ts";
import type { Listing } from "./listings.ts";

const SPARK_SESSIONS = 40;

function sparkline(candles: readonly Candle[]): string {
  const closes = candles.slice(-SPARK_SESSIONS).map((bar) => bar.close);
  const low = Math.min(...closes);
  const span = Math.max(...closes) - low || 1;

  return closes
    .map((close, i) => {
      const x = (i / (closes.length - 1)) * 100;
      const y = 22 - ((close - low) / span) * 20;

      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join("");
}

export interface WatchlistProps {
  listings: readonly { listing: Listing; candles: readonly Candle[] }[];
  selected: string;
  onSelect: (code: string) => void;
}

/**
 * The symbols pane: each row its quote, the session's change and two months of closes. One row is
 * always pressed, since the chart shows one listing.
 */
export function Watchlist({ listings, selected, onSelect }: WatchlistProps) {
  const { t } = useTranslation();
  const { t: app } = useTranslation("desktop");

  return (
    <section aria-labelledby="watchlist-title" className="flex flex-col">
      <h3 id="watchlist-title" className="px-4 pt-3 pb-2 text-sm font-semibold">
        {app("watchlist.title")}
      </h3>
      <ToggleGroup
        aria-labelledby="watchlist-title"
        value={[selected]}
        onValueChange={([code]) => {
          if (code) onSelect(code);
        }}
        className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:overflow-visible">
        {listings.map(({ listing, candles }) => {
          const { ratio } = sessionChange(candles);
          const rising = ratio > 0;

          return (
            <Toggle
              key={listing.code}
              value={listing.code}
              className="focus-visible:outline-ring grid w-44 shrink-0 grid-cols-[1fr_auto] items-baseline gap-x-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-2 data-pressed:bg-accent lg:w-full">
              <span className="truncate text-sm">
                <span className="font-medium">{listing.code}</span>{" "}
                {listing.name}
              </span>
              <span className="text-sm font-medium">{price(listing.last)}</span>
              <svg
                aria-hidden="true"
                viewBox="0 0 100 24"
                preserveAspectRatio="none"
                className={`col-span-2 mt-1 h-5 w-full ${rising ? "text-rise" : "text-fall"}`}>
                <path
                  d={sparkline(candles)}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.25"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <span className="text-muted-foreground text-xs">
                {t("demo.market")}
              </span>
              <span className={`text-xs ${rising ? "text-rise" : "text-fall"}`}>
                {percent(ratio)}
              </span>
            </Toggle>
          );
        })}
      </ToggleGroup>
    </section>
  );
}
