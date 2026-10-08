import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { Position } from "@solyx/core/order";

import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { SymbolRow } from "../../components/symbol-row.tsx";
import { ListingName } from "../market/listing-name.tsx";
import { numberFormats } from "../market/number-formats.ts";
import { useDirectionColors } from "../market/price-colors.ts";
import {
  QuoteLine,
  QuotePrice,
  directionOf,
} from "../market/quote-figures.tsx";
import { quoteQuery } from "../market/quote-query.ts";

import { accountQuery } from "./account-query.ts";

/** A holding's gain at its listing's last price, in the colour of a move that size. */
function PositionGain({
  symbol,
  position,
}: {
  symbol: SymbolRef;
  position: Position;
}) {
  const { t, i18n } = useTranslation();
  const { data } = useQuery(quoteQuery(symbol));
  const direction = useDirectionColors(symbol.market);
  const format = numberFormats(i18n.language);

  if (!data) return null;

  const gain = (data.last - position.avgPrice) * position.quantity;

  return (
    <span className={directionOf(direction, gain)?.text ?? "text-muted"}>
      <span className="sr-only">{t("account.unrealized-gain")} </span>
      {format.signedAmount.format(gain)}
    </span>
  );
}

/** Held listings with their session's line, last price and gain, each opening its chart. */
export function PositionList() {
  const { t } = useTranslation();
  const { data, error, refetch } = useQuery(accountQuery());

  if (error) {
    return (
      <div className="px-4">
        <LoadError error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  if (!data) return <LoadingState />;

  if (data.positions.length === 0) {
    return (
      <p className="px-4 text-xs text-muted">{t("account.no-positions")}</p>
    );
  }

  return (
    <ul>
      {data.positions.map((position) => {
        const symbol = {
          market: position.instrument.market,
          symbol: position.instrument.symbol,
        };

        return (
          <li key={symbolKey(position.instrument)}>
            <SymbolRow
              symbol={symbol}
              name={<ListingName symbol={symbol} />}
              price={<QuotePrice symbol={symbol} />}
              chart={<QuoteLine symbol={symbol} className="size-full" />}
              detail={<PositionGain symbol={symbol} position={position} />}
            />
          </li>
        );
      })}
    </ul>
  );
}
