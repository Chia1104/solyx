import { CloseButton } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { SymbolRow } from "../../components/symbol-row.tsx";
import { ListingName } from "../market/listing-name.tsx";

import { watchlistQuery, watchlistQueryKeys } from "./watchlist-query.ts";

export function Watchlist() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data, error, refetch } = useQuery(watchlistQuery());

  const remove = useMutation({
    mutationFn: (symbol: SymbolRef) => window.solyx.watchlist.remove(symbol),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: watchlistQueryKeys.all }),
  });

  if (error) {
    return (
      <div className="px-4">
        <LoadError error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  if (!data) return <LoadingState />;

  if (data.length === 0) {
    return (
      <p className="mx-4 rounded-sm pencil px-3 py-3 text-xs text-muted">
        {t("watchlist.empty")}
      </p>
    );
  }

  return (
    <>
      <ul>
        {data.map((symbol) => (
          <li key={symbolKey(symbol)} className="group relative">
            <SymbolRow symbol={symbol} name={<ListingName symbol={symbol} />} />
            <CloseButton
              aria-label={t("watchlist.remove-symbol", {
                symbol: symbol.symbol,
              })}
              isDisabled={remove.isPending}
              className="absolute top-1/2 right-2 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onPress={() => remove.mutate(symbol)}
            />
          </li>
        ))}
      </ul>
      {remove.error ? (
        <div className="px-4 pt-2">
          <ErrorAlert
            title={t("watchlist.update-failed")}
            description={remove.error.message}
          />
        </div>
      ) : null}
    </>
  );
}
