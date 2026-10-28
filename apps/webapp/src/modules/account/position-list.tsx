import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { symbolKey } from "@solyx/core/market";
import type { Market } from "@solyx/core/market";

import { orpc } from "../../app/rpc.ts";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import {
  MarketGroups,
  groupByMarket,
} from "../../components/market-groups.tsx";
import { SymbolRow } from "../../components/symbol-row.tsx";
import { ListingName } from "../market/listing-name.tsx";
import { QuoteLine, QuotePrice } from "../market/quote-figures.tsx";

import { PositionGain } from "./position-figures.tsx";

/**
 * Held listings in `market`, or in every market with each under its own heading once there are
 * more than one, with their session's line, last price and gain, each opening its chart.
 */
export function PositionList({ market }: { market: Market | null }) {
  const { t } = useTranslation();

  const { data, error, refetch } = useQuery(
    orpc.account.summary.queryOptions()
  );

  if (error) {
    return (
      <div>
        <LoadError error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  if (!data) return <LoadingState />;

  const markets = groupByMarket(
    data.positions,
    ({ instrument }) => instrument.market,
    market
  );

  if (markets.length === 0) {
    return (
      <p className="px-4 text-xs text-muted">
        {market && data.positions.length > 0
          ? t("account.no-positions-market", {
              market: t(`market.${market}`),
            })
          : t("account.no-positions")}
      </p>
    );
  }

  return (
    <MarketGroups groups={markets}>
      {({ items }) => (
        <ul>
          {items.map((position) => {
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
      )}
    </MarketGroups>
  );
}
