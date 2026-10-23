import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { SymbolRef } from "@solyx/core/market";
import { positionValue } from "@solyx/core/order";
import type { Position } from "@solyx/core/order";

import { numberFormats } from "../market/number-formats.ts";
import { useDirectionColors } from "../market/price-colors.ts";
import { directionOf } from "../market/quote-figures.tsx";
import { quoteQuery } from "../market/quote-query.ts";

/** A holding marked at its listing's last price; `null` until the quote loads. */
function useMarked(symbol: SymbolRef, position: Position) {
  const { data } = useQuery(quoteQuery(symbol));

  return data ? positionValue(position, data.last) : null;
}

/** A holding's gain at its listing's last price, in the colour of a move that size. */
export function PositionGain({
  symbol,
  position,
}: {
  symbol: SymbolRef;
  position: Position;
}) {
  const { t, i18n } = useTranslation();
  const marked = useMarked(symbol, position);
  const direction = useDirectionColors(symbol.market);

  if (!marked) return null;

  return (
    <span className={directionOf(direction, marked.gain)?.text ?? "text-muted"}>
      <span className="sr-only">{t("account.unrealized-gain")} </span>
      {numberFormats(i18n.language).signedAmount.format(marked.gain)}
    </span>
  );
}

/** That gain as a share of what the holding cost. */
export function PositionReturn({
  symbol,
  position,
}: {
  symbol: SymbolRef;
  position: Position;
}) {
  const { i18n } = useTranslation();
  const marked = useMarked(symbol, position);
  const direction = useDirectionColors(symbol.market);

  if (!marked || marked.gainPercent === null) return null;

  return (
    <span className={directionOf(direction, marked.gain)?.text ?? "text-muted"}>
      {numberFormats(i18n.language).quotePercentChange.format(
        marked.gainPercent
      )}
    </span>
  );
}

/** The listing's last price. */
export function PositionLast({ symbol }: { symbol: SymbolRef }) {
  const { i18n } = useTranslation();
  const { data } = useQuery(quoteQuery(symbol));

  return data ? numberFormats(i18n.language).price.format(data.last) : null;
}
