import { useEffect, useRef } from "react";

import { useTranslation } from "react-i18next";

import type { SymbolRef } from "@solyx/core/market";
import type { SessionQuote } from "@solyx/core/quote";

import { highlight } from "../../components/highlight.ts";
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
/** The newest session's last price, which flashes in its direction's colour when a refresh moves it. */
export function QuotePrice({ symbol }: { symbol: SymbolRef }) {
  const { i18n } = useTranslation();
  const { data } = useQuote(symbol);
  const direction = useDirectionColors(symbol.market);
  const element = useRef<HTMLSpanElement>(null);
  const seen = useRef<number | undefined>(undefined);

  const last = data?.last;

  useEffect(() => {
    const before = seen.current;

    seen.current = last;

    if (last === undefined || before === undefined || last === before) return;

    highlight(
      element.current,
      (last > before ? direction.rise : direction.fall).solid
    );
  }, [last, direction]);

  if (last === undefined) return null;

  return (
    <span ref={element} className="-mx-1 rounded-sm px-1">
      {numberFormats(i18n.language).price.format(last)}
    </span>
  );
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
