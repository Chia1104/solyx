import { useEffect, useRef } from "react";

import { CloseButton } from "@heroui/react";
import { DragDropVerticalIcon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  DropIndicator,
  GridList,
  GridListItem,
  useDragAndDrop,
} from "react-aria-components";
import { useTranslation } from "react-i18next";

import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import { usePaletteColors } from "../../app/theme.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { highlight } from "../../components/highlight.ts";
import { Icon } from "../../components/icon.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { SymbolRow } from "../../components/symbol-row.tsx";
import { ListingName, listingName } from "../market/listing-name.tsx";
import { listingQuery } from "../market/listing-query.ts";
import {
  QuoteChange,
  QuoteLine,
  QuotePrice,
} from "../market/quote-figures.tsx";

import { watchlistQuery, watchlistQueryKeys } from "./watchlist-query.ts";

/** `listings` with `symbol` taken out and put back at `index` among the others. */
function moved(listings: SymbolRef[], symbol: SymbolRef, index: number) {
  return listings
    .filter((each) => symbolKey(each) !== symbolKey(symbol))
    .toSpliced(index, 0, symbol);
}

/** The listings the user watches, in their order, which they set by dragging a row or its handle. */
export function Watchlist() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { data, error, refetch } = useQuery(watchlistQuery());
  const { accent } = usePaletteColors();
  const list = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string> | undefined>(undefined);

  // A listing added from its chart lights up where it lands, which is often far from the button.
  useEffect(() => {
    if (!data) return;

    const before = seen.current;
    const keys = data.map(symbolKey);

    seen.current = new Set(keys);

    if (!before) return;

    const added = keys.filter((key) => !before.has(key));

    if (added.length === 0) return;

    // The grid renders its rows a pass after the list changes, so they are looked up a frame later.
    const frame = requestAnimationFrame(() => {
      for (const key of added) {
        highlight(
          list.current?.querySelector(`[data-key="${CSS.escape(key)}"] a`),
          accent
        );
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [data, accent]);

  const settle = () =>
    queryClient.invalidateQueries({ queryKey: watchlistQueryKeys.all });

  const remove = useMutation({
    mutationFn: (symbol: SymbolRef) => window.solyx.watchlist.remove(symbol),
    onSettled: settle,
  });

  // The row lands where it was dropped at once; the main process's order replaces it once saved.
  const move = useMutation({
    mutationFn: ({ symbol, index }: { symbol: SymbolRef; index: number }) =>
      window.solyx.watchlist.move(symbol, index),
    onMutate: async ({ symbol, index }) => {
      await queryClient.cancelQueries({ queryKey: watchlistQueryKeys.all });

      queryClient.setQueryData(
        watchlistQuery().queryKey,
        (current) => current && moved(current, symbol, index)
      );
    },
    onSettled: settle,
  });

  const { dragAndDropHooks } = useDragAndDrop<{ symbol: SymbolRef }>({
    getItems: (_keys, items) =>
      items.map(({ symbol }) => {
        const listing = queryClient.getQueryData(listingQuery(symbol).queryKey);

        return {
          "text/plain": [symbol.symbol, listingName(listing, i18n.language)]
            .filter(Boolean)
            .join(" "),
        };
      }),
    onReorder({ keys, target }) {
      const [key] = keys;
      const symbol = data?.find((each) => symbolKey(each) === key);
      const others = data?.filter((each) => symbolKey(each) !== key) ?? [];
      const at = others.findIndex((each) => symbolKey(each) === target.key);

      if (!symbol || at < 0) return;

      move.mutate({
        symbol,
        index: target.dropPosition === "after" ? at + 1 : at,
      });
    },
    // Where the row will land is inked; the row in flight is still pencil.
    renderDropIndicator: (target) => (
      <DropIndicator
        target={target}
        className="-my-px h-0.5 data-[drop-target]:bg-accent"
      />
    ),
    renderDragPreview: ([item]) => (
      <div className="rounded-sm pencil px-3 py-1.5 text-sm font-medium">
        {item["text/plain"]}
      </div>
    ),
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

  const actionError = remove.error ?? move.error;

  return (
    <>
      <GridList
        ref={list}
        aria-label={t("watchlist.title")}
        items={data.map((symbol) => ({ id: symbolKey(symbol), symbol }))}
        dragAndDropHooks={dragAndDropHooks}
        className="outline-none">
        {({ symbol }) => (
          <GridListItem
            textValue={symbol.symbol}
            className="group relative outline-none data-[dragging]:opacity-40 data-[focus-visible]:bg-default">
            <Button
              slot="drag"
              className="absolute inset-y-0 left-0 flex w-4 cursor-grab items-center justify-center text-muted opacity-0 outline-none group-hover:opacity-100 data-[focus-visible]:text-accent data-[focus-visible]:opacity-100">
              <Icon icon={DragDropVerticalIcon} className="size-3" />
            </Button>
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
          </GridListItem>
        )}
      </GridList>
      {actionError ? (
        <div className="px-4 pt-2">
          <ErrorAlert
            title={t("watchlist.update-failed")}
            description={actionError.message}
          />
        </div>
      ) : null}
    </>
  );
}
