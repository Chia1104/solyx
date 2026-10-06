import { useTranslation } from "react-i18next";

import type { SymbolRef } from "@solyx/core/market";
import type { SessionQuote } from "@solyx/core/quote";

import { Sparkline } from "../../components/sparkline.tsx";

import { numberFormats } from "./number-formats.ts";
import { useDirectionColors } from "./price-colors.ts";
import type { DirectionColors } from "./price-colors.ts";
import { useQuote } from "./quote-query.ts";

/** How far the last price moved from the close before, or `null` without that close. */
export function quoteChange(quote: SessionQuote) {
  const { last, previousClose } = quote;

  return previousClose === null
    ? null
    : {
        change: last - previousClose,
        percent: (last - previousClose) / previousClose,
      };
}

/** The colours of a move in its direction, or `undefined` for none. */
export function directionOf(direction: DirectionColors, change: number) {
  if (change > 0) return direction.rise;

  return change < 0 ? direction.fall : undefined;
}

/** The newest session's line against the close before, drawn in the direction it moved. */
export function QuoteLine({
  symbol,
  className,
}: {
  symbol: SymbolRef;
  className?: string;
}) {
  const { data } = useQuote(symbol);
  const direction = useDirectionColors(symbol.market);

  if (!data) return <span aria-hidden className={className} />;

  const moved = quoteChange(data);

  return (
    <Sparkline
      points={data.line.map(({ time, close }) => ({ time, value: close }))}
      from={data.hours.open}
      to={data.hours.close}
      baseline={data.previousClose}
      color={
        (moved && directionOf(direction, moved.change)?.solid) ?? "var(--muted)"
      }
      className={className}
    />
  );
}

/** The newest session's last price. */
export function QuotePrice({ symbol }: { symbol: SymbolRef }) {
  const { i18n } = useTranslation();
  const { data } = useQuote(symbol);

  return data ? numberFormats(i18n.language).price.format(data.last) : null;
}

/** The change since the close before, in percent and in the colour of its direction. */
export function QuoteChange({ symbol }: { symbol: SymbolRef }) {
  const { i18n } = useTranslation();
  const { data } = useQuote(symbol);
  const direction = useDirectionColors(symbol.market);

  const moved = data ? quoteChange(data) : null;

  if (!moved) return null;

  return (
    <span
      className={directionOf(direction, moved.change)?.text ?? "text-muted"}>
      {numberFormats(i18n.language).quotePercentChange.format(moved.percent)}
    </span>
  );
}
