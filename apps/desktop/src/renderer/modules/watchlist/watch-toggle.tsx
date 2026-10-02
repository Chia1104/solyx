import { Button } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isEqual } from "es-toolkit";
import { useTranslation } from "react-i18next";

import type { SymbolRef } from "@solyx/core/market";

import { watchlistQuery, watchlistQueryKeys } from "./watchlist-query.ts";

/** Adds the open listing to the watchlist or takes it off. */
export function WatchToggle({ symbol }: { symbol: SymbolRef }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data } = useQuery(watchlistQuery());

  const watched = data?.some((other) => isEqual(other, symbol)) ?? false;

  const update = useMutation({
    mutationFn: () =>
      watched
        ? window.solyx.watchlist.remove(symbol)
        : window.solyx.watchlist.add(symbol),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: watchlistQueryKeys.all }),
  });

  return (
    <div className="flex items-center gap-2">
      {update.error ? (
        <span role="alert" className="text-xs text-danger">
          {t("watchlist.update-failed")}
        </span>
      ) : null}
      <Button
        size="sm"
        variant={watched ? "ghost" : "secondary"}
        isDisabled={!data}
        isPending={update.isPending}
        onPress={() => update.mutate()}>
        {watched ? t("watchlist.remove") : t("watchlist.add")}
      </Button>
    </div>
  );
}
