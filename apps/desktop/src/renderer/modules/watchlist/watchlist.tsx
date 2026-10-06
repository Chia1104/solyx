import { useEffect, useRef } from "react";

import { CloseButton } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import { usePaletteColors } from "../../app/theme.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { highlight } from "../../components/highlight.ts";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { SymbolRow } from "../../components/symbol-row.tsx";
import { ListingName } from "../market/listing-name.tsx";
import {
  QuoteChange,
  QuoteLine,
  QuotePrice,
} from "../market/quote-figures.tsx";

import { watchlistQuery, watchlistQueryKeys } from "./watchlist-query.ts";

export function Watchlist() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data, error, refetch } = useQuery(watchlistQuery());
  const { accent } = usePaletteColors();
  const list = useRef<HTMLUListElement>(null);
  const seen = useRef<Set<string> | undefined>(undefined);

  // A listing added from its chart lights up where it lands, which is often far from the button.
  useEffect(() => {
    if (!data) return;

    const before = seen.current;
    const keys = data.map(symbolKey);

    seen.current = new Set(keys);

    if (!before) return;

    for (const key of keys) {
      if (before.has(key)) continue;

      highlight(
        list.current?.querySelector(`[data-symbol="${CSS.escape(key)}"] a`),
        accent
      );
    }
  }, [data, accent]);

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
      <ul ref={list}>
        {data.map((symbol) => (
          <li
            key={symbolKey(symbol)}
            data-symbol={symbolKey(symbol)}
            className="group relative">
            <SymbolRow
              symbol={symbol}
              name={<ListingName symbol={symbol} />}
              price={
                // The remove button takes the price's place while the row is hovered.
                <span className="transition-opacity group-hover:opacity-0 group-has-[button:focus-visible]:opacity-0 motion-reduce:transition-none">
                  <QuotePrice symbol={symbol} />
                </span>
              }
              chart={<QuoteLine symbol={symbol} className="size-full" />}
              detail={<QuoteChange symbol={symbol} />}
            />
            <CloseButton
              aria-label={t("watchlist.remove-symbol", {
                symbol: symbol.symbol,
              })}
              isDisabled={remove.isPending}
              className="absolute top-1 right-2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"
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
