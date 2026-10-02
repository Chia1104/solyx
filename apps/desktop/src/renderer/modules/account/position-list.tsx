import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { symbolKey } from "@solyx/core/market";

import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { SymbolRow } from "../../components/symbol-row.tsx";
import { ListingName } from "../market/listing-name.tsx";

import { accountQuery } from "./account-query.ts";

/** Held listings with their share counts, each opening its chart. */
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
            <SymbolRow symbol={symbol} name={<ListingName symbol={symbol} />}>
              {t("account.shares-count", { count: position.quantity })}
            </SymbolRow>
          </li>
        );
      })}
    </ul>
  );
}
