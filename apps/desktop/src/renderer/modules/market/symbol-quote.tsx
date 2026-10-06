import { cn } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { Interval } from "@solyx/core/candles";
import type { SymbolRef } from "@solyx/core/market";

import { useListingName } from "./listing-name.tsx";
import { numberFormats } from "./number-formats.ts";
import { useDirectionColors } from "./price-colors.ts";
import { useCandles } from "./use-candles.ts";

/**
 * The listing's code and name, and its last daily close against the close before it, on one line.
 * As the main view narrows the name truncates and the market and the change in points drop out;
 * the code, the price and the change in percent always show.
 */
export function SymbolQuote({ symbol }: { symbol: SymbolRef }) {
  const { t, i18n } = useTranslation();
  const { candles } = useCandles(symbol, Interval.OneDay);
  const name = useListingName(symbol);

  const bars = candles.data?.candles ?? [];
  const last = bars.at(-1);
  const previous = bars.at(-2);
  const format = numberFormats(i18n.language);
  const direction = useDirectionColors(symbol.market);

  const change = last && previous ? last.close - previous.close : null;

  return (
    <div className="flex min-w-0 items-baseline gap-3 @min-[34rem]/main:gap-4">
      <h1 className="flex min-w-0 items-baseline gap-2">
        <span className="text-base font-semibold">{symbol.symbol}</span>
        {name ? <span className="truncate text-sm">{name}</span> : null}
        <span className="hidden shrink-0 text-xs text-muted @min-[44rem]/main:inline">
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
                <span className="hidden @min-[34rem]/main:inline">
                  {format.quoteChange.format(change)}
                </span>
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
