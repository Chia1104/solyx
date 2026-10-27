import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { symbolKey } from "@solyx/core/market";

import { orpc } from "../../app/rpc.ts";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { SymbolRow } from "../../components/symbol-row.tsx";
import { ListingName } from "../market/listing-name.tsx";
import { QuoteLine, QuotePrice } from "../market/quote-figures.tsx";

import { PositionGain } from "./position-figures.tsx";

/** Held listings with their session's line, last price and gain, each opening its chart. */
export function PositionList() {
  const { t } = useTranslation();

  const { data, error, refetch } = useQuery(
    orpc.account.summary.queryOptions()
  );

  if (error) {
    return (
      <div className="px-2">
        <LoadError error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  if (!data) return <LoadingState />;

  if (data.positions.length === 0) {
    return (
      <p className="px-5 text-xs text-muted">{t("account.no-positions")}</p>
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
