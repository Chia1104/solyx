import { cn } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { memoize } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { Interval } from "@solyx/core/candles";
import { Market } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import { Locale } from "../../app/i18n.ts";

import { listingQuery } from "./listing-query.ts";
import { useCandles } from "./use-candles.ts";

const quoteFormats = memoize((locale: string) => ({
  price: new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }),
  change: new Intl.NumberFormat(locale, {
    signDisplay: "exceptZero",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }),
  percent: new Intl.NumberFormat(locale, {
    style: "percent",
    signDisplay: "exceptZero",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
}));

// Taiwan quotes rising prices in red and falling ones in green; US quotes do the opposite.
const DIRECTION_CLASS: Record<Market, { rise: string; fall: string }> = {
  [Market.TW]: { rise: "text-quote-red", fall: "text-quote-green" },
  [Market.US]: { rise: "text-quote-green", fall: "text-quote-red" },
};

/** The listing's code and name, and its last daily close against the close before it, on one line. */
export function SymbolQuote({ symbol }: { symbol: SymbolRef }) {
  const { t, i18n } = useTranslation();
  const { ready, candles } = useCandles(symbol, Interval.OneDay);
  const listing = useQuery({ ...listingQuery(symbol), enabled: ready });

  const bars = candles.data?.candles ?? [];
  const last = bars.at(-1);
  const previous = bars.at(-2);
  const format = quoteFormats(i18n.language);

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
            {format.price.format(last.close)}
          </dd>
          {previous && change !== null ? (
            <>
              <dt className="sr-only">{t("chart.quote.change")}</dt>
              <dd
                className={cn(
                  "flex gap-1.5 text-xs font-medium tabular-nums",
                  change > 0 && DIRECTION_CLASS[symbol.market].rise,
                  change < 0 && DIRECTION_CLASS[symbol.market].fall
                )}>
                <span>{format.change.format(change)}</span>
                <span>{format.percent.format(change / previous.close)}</span>
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}
