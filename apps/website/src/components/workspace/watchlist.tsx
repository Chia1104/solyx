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

/** The symbols pane: each row its quote, the session's change and two months of closes. */
export function Watchlist({ listings, selected, onSelect }: WatchlistProps) {
  return (
    <nav aria-label="Watchlist" className="flex flex-col">
      <h3 className="px-4 pt-3 pb-2 text-sm font-semibold">Watchlist</h3>
      <ul className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:overflow-visible">
        {listings.map(({ listing, candles }) => {
          const { ratio } = sessionChange(candles);
          const rising = ratio > 0;

          return (
            <li key={listing.code} className="shrink-0">
              <button
                type="button"
                aria-current={listing.code === selected}
                onClick={() => onSelect(listing.code)}
                className="hover:bg-sheet-2 focus-visible:outline-ink aria-[current=true]:bg-sheet-3 grid w-44 grid-cols-[1fr_auto] items-baseline gap-x-2 rounded-md px-2 py-2 text-left transition-colors focus-visible:outline-2 lg:w-full">
                <span className="truncate text-sm">
                  <span className="font-medium">{listing.code}</span>{" "}
                  {listing.name}
                </span>
                <span className="text-sm font-medium">
                  {price(listing.last)}
                </span>
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
                <span className="text-xs text-muted">TW</span>
                <span
                  className={`text-xs ${rising ? "text-rise" : "text-fall"}`}>
                  {percent(ratio)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
