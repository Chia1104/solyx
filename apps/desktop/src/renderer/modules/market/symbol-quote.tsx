import { cn } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Interval } from "@solyx/core/candles";
import type { SymbolRef } from "@solyx/core/market";

import { Locale } from "#shared/ipc/settings.ts";

import { DIRECTION_COLORS } from "./chart-palette.ts";
import { listingQuery } from "./listing-query.ts";
import { numberFormats } from "./number-formats.ts";
import { useCandles } from "./use-candles.ts";

/** The listing's code and name, and its last daily close against the close before it, on one line. */
export function SymbolQuote({ symbol }: { symbol: SymbolRef }) {
  const { t, i18n } = useTranslation();
  const { ready, candles } = useCandles(symbol, Interval.OneDay);
  const listing = useQuery({ ...listingQuery(symbol), enabled: ready });

  const bars = candles.data?.candles ?? [];
  const last = bars.at(-1);
  const previous = bars.at(-2);
  const format = numberFormats(i18n.language);
  const direction = DIRECTION_COLORS[symbol.market];

  const change = last && previous ? last.close - previous.close : null;

  // Exchanges name listings in their own language; the English name is used when there is one.
  const name =
    i18n.language === Locale.EnUS
      ? (listing.data?.englishName ?? listing.data?.name)
      : listing.data?.name;

  return (
    <div className="flex min-w-0 items-baseline gap-4">
      <h1 className="flex min-w-0 items-baseline gap-2">
        <span className="text-base font-semibold">{symbol.symbol}</span>
        {name ? <span className="truncate text-sm">{name}</span> : null}
        <span className="shrink-0 text-xs text-muted">
          {t(`market.${symbol.market}`)}
        </span>
      </h1>
      {last ? (
        <dl className="flex shrink-0 items-baseline gap-2">
          <dt className="sr-only">{t("chart.quote.last")}</dt>
          <dd className="text-base font-semibold tabular-nums">
            {format.quotePrice.format(last.close)}
          </dd>
          {previous && change !== null ? (
            <>
              <dt className="sr-only">{t("chart.quote.change")}</dt>
              <dd
                className={cn(
                  "flex gap-1.5 text-xs font-medium tabular-nums",
                  change > 0 && direction.rise.text,
                  change < 0 && direction.fall.text
                )}>
                <span>{format.quoteChange.format(change)}</span>
                <span>
                  {format.quotePercentChange.format(change / previous.close)}
                </span>
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}
