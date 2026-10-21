import { cn } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { exchangeDate, symbolKey } from "@solyx/core/market";
import type { Market } from "@solyx/core/market";
import type { RoundTrip } from "@solyx/core/review";
import { cssPercent } from "@solyx/utils/format";

import {
  ChartTooltip,
  useChartHover,
} from "../../components/chart-tooltip.tsx";
import { Sparkline } from "../../components/sparkline.tsx";
import { numberFormats } from "../market/number-formats.ts";
import { useDirectionColors } from "../market/price-colors.ts";
import { directionOf } from "../market/quote-figures.tsx";

/** As many of the newest trips as stay apart as columns in the narrowest pane; the line covers them all. */
const COLUMNS = 40;

/**
 * What closed round trips have realized in one market's currency: the running total from zero by
 * when each closed, and under it the newest trips a column each, a gain above the line and a loss
 * below in their direction's colours, each named as it is hovered. Nothing is drawn for fewer
 * than two trips.
 */
export function RealizedTrend({
  trips,
  market,
}: {
  trips: readonly RoundTrip[];
  market: Market;
}) {
  const { t, i18n } = useTranslation();
  const { signedAmount } = numberFormats(i18n.language);
  const direction = useDirectionColors(market);
  const { hover, show, hide } = useChartHover();

  if (trips.length < 2) return null;

  const closed = trips.toSorted((a, b) => a.closedAt - b.closedAt);

  // The running total from zero, by when each trip closed.
  const points = [{ time: closed[0].openedAt, value: 0 }];

  for (const trip of closed) {
    points.push({
      time: trip.closedAt,
      value: (points.at(-1)?.value ?? 0) + trip.realized,
    });
  }

  const shown = closed.slice(-COLUMNS);
  const largest = Math.max(...shown.map(({ realized }) => Math.abs(realized)));

  const describe = (trip: RoundTrip) =>
    t("account.realized-trip", {
      date: exchangeDate(trip.instrument.market, new Date(trip.closedAt)),
      symbol: trip.instrument.symbol,
      realized: signedAmount.format(trip.realized),
    });

  const hovered = hover ? shown[hover.index] : undefined;

  return (
    <figure
      aria-label={t("account.realized-trend")}
      className="flex flex-col gap-1">
      <Sparkline
        points={points}
        from={closed[0].openedAt}
        to={closed.at(-1)?.closedAt ?? closed[0].closedAt}
        baseline={0}
        color="var(--accent)"
        className="h-12 w-full"
      />
      <div className="relative h-8">
        <span
          aria-hidden
          className="absolute inset-x-0 top-1/2 h-px bg-separator"
        />
        {/* The newest trip sits under the line's end. */}
        <ol
          className="relative flex h-full justify-end gap-[2px]"
          onPointerLeave={hide}>
          {shown.map((trip, index) => {
            const share = largest === 0 ? 0 : Math.abs(trip.realized) / largest;

            return (
              <li
                key={`${symbolKey(trip.instrument)}-${trip.closedAt}`}
                className="relative h-full max-w-2 min-w-[2px] flex-1"
                onPointerMove={(event) => show(index, event)}>
                <span className="sr-only">{describe(trip)}</span>
                <span
                  className={cn(
                    "absolute inset-x-0 min-h-px",
                    trip.realized >= 0
                      ? "bottom-1/2 rounded-t-[2px]"
                      : "top-1/2 rounded-b-[2px]",
                    hover && hover.index !== index && "opacity-40"
                  )}
                  style={{
                    height: cssPercent(share / 2),
                    backgroundColor:
                      directionOf(direction, trip.realized)?.solid ??
                      "var(--muted)",
                  }}
                />
              </li>
            );
          })}
        </ol>
      </div>
      <ChartTooltip hover={hover}>
        {hovered ? describe(hovered) : null}
      </ChartTooltip>
    </figure>
  );
}
