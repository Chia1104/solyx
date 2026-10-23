import { useEffect, useRef } from "react";

import { Chip, cn } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { Interval } from "@solyx/core/candles";
import type { SymbolRef } from "@solyx/core/market";
import type { Depth } from "@solyx/core/market-data";

import { highlight } from "../../components/highlight.ts";

import { useListingName } from "./listing-name.tsx";
import { numberFormats } from "./number-formats.ts";
import { useDirectionColors } from "./price-colors.ts";
import { useCandles } from "./use-candles.ts";

/**
 * The listing's code and name and its last price against its reference, on one line: the
 * session's as the book reports it where the page follows it, else the last daily close against
 * the close before. A pushed price flashes in its direction. As the main view narrows the name
 * truncates and the market and the change in points drop out; the code, the price and the change
 * in percent always show.
 */
export function SymbolQuote({
  symbol,
  depth,
}: {
  symbol: SymbolRef;
  depth: Depth | null | undefined;
}) {
  const { t, i18n } = useTranslation();
  const { candles } = useCandles(symbol, Interval.OneDay);
  const name = useListingName(symbol);
  const format = numberFormats(i18n.language);
  const direction = useDirectionColors(symbol.market);
  const priceElement = useRef<HTMLElement>(null);
  const seen = useRef<number | null>(null);

  const bars = candles.data?.candles ?? [];
  const live = depth?.last !== null && depth?.last !== undefined;
  const last = live ? depth.last : (bars.at(-1)?.close ?? null);
  const base = live ? depth.reference : (bars.at(-2)?.close ?? null);
  const change = last !== null && base !== null ? last - base : null;

  useEffect(() => {
    const before = seen.current;

    seen.current = last;

    if (!live || last === null || before === null || last === before) return;

    highlight(
      priceElement.current,
      (last > before ? direction.rise : direction.fall).solid
    );
  }, [live, last, direction]);

  return (
    <div className="flex min-w-0 items-baseline gap-3 @min-[34rem]/main:gap-4">
      <h1 className="flex min-w-0 items-baseline gap-2">
        <span className="text-base font-semibold">{symbol.symbol}</span>
        {name ? <span className="truncate text-sm">{name}</span> : null}
        <span className="hidden shrink-0 text-xs text-muted @min-[44rem]/main:inline">
          {t(`market.${symbol.market}`)}
        </span>
      </h1>
      {last === null ? null : (
        <dl className="flex shrink-0 items-baseline gap-2">
          <dt className="sr-only">{t("chart.quote.last")}</dt>
          <dd
            ref={priceElement}
            className={cn(
              "-mx-1 rounded-sm px-1 text-base font-semibold tabular-nums",
              live && change !== null && change > 0 && direction.rise.text,
              live && change !== null && change < 0 && direction.fall.text
            )}>
            {format.quotePrice.format(last)}
          </dd>
          {change !== null && base !== null ? (
            <>
              <dt className="sr-only">
                {live
                  ? t("chart.quote.change-reference")
                  : t("chart.quote.change")}
              </dt>
              <dd
                className={cn(
                  "flex gap-1.5 text-xs font-medium tabular-nums",
                  change > 0 && direction.rise.text,
                  change < 0 && direction.fall.text
                )}>
                <span className="hidden @min-[34rem]/main:inline">
                  {format.quoteChange.format(change)}
                </span>
                <span>{format.quotePercentChange.format(change / base)}</span>
              </dd>
            </>
          ) : null}
        </dl>
      )}
      {depth?.trial ? (
        <Chip size="sm" variant="soft" className="shrink-0 self-center">
          {t("depth.trial")}
        </Chip>
      ) : null}
    </div>
  );
}
