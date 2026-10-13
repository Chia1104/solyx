import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { SymbolRef } from "@solyx/core/market";
import type { Report } from "@solyx/core/report";

import { numberFormats } from "../market/number-formats.ts";
import { quoteQuery } from "../market/quote-query.ts";

import { rangePlace } from "./research-figures.ts";

const share = (value: number) => `${value * 100}%`;

/**
 * A report's fair range and, once the listing's quote is read, where its last price stands
 * against it. The quote is the one the page already shows, so drawing this asks for nothing more.
 */
export function ValuationRange({
  symbol,
  valuation,
}: {
  symbol: SymbolRef;
  valuation: NonNullable<Report["valuation"]>;
}) {
  const { t, i18n } = useTranslation();
  const { price, percentChange } = numberFormats(i18n.language);
  const { data: quote } = useQuery(quoteQuery(symbol));

  const place = quote
    ? rangePlace(valuation.low, valuation.high, quote.last)
    : null;

  return (
    <section className="flex flex-col gap-2">
      <p>
        <span className="tabular-nums">
          {t("research.report.valuation", {
            low: price.format(valuation.low),
            high: price.format(valuation.high),
          })}
        </span>
        <span className="text-muted"> · {valuation.basis}</span>
      </p>
      {place && quote ? (
        <>
          <div
            aria-hidden
            className="relative h-1 max-w-md rounded-full bg-surface-secondary">
            <span
              className="absolute inset-y-0 rounded-full bg-muted"
              style={{ left: share(place.from), right: share(1 - place.to) }}
            />
            <i
              className="absolute -top-[5px] h-3.5 w-0.5 -translate-x-px bg-foreground ring-2 ring-background"
              style={{ left: share(place.at) }}
            />
          </div>
          <p className="text-xs text-muted tabular-nums">
            {t(`research.report.price-${place.side}`, {
              price: price.format(quote.last),
              date: quote.date,
              low: percentChange.format(place.fromLow),
              high: percentChange.format(place.fromHigh),
            })}
          </p>
        </>
      ) : null}
    </section>
  );
}
