import { useEffect, useRef } from "react";

import { CloseButton, ListLayout, Virtualizer } from "@heroui/react";
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
import type { Market, SymbolRef } from "@solyx/core/market";

import { orpc } from "../../app/rpc.ts";
import { usePaletteColors } from "../../app/theme.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { highlight } from "../../components/highlight.ts";
import { Icon } from "../../components/icon.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import {
  MarketGroups,
  groupByMarket,
} from "../../components/market-groups.tsx";
import { SymbolRow } from "../../components/symbol-row.tsx";
import { ListingName, listingName } from "../market/listing-name.tsx";
import { listingQuery } from "../market/listing-query.ts";
import {
  QuoteChange,
  QuoteLine,
  QuotePrice,
} from "../market/quote-figures.tsx";

import { watchlistQuery } from "./watchlist-query.ts";

/** `listings` with `symbol` taken out and put back at `index` among the others. */
function moved(listings: SymbolRef[], symbol: SymbolRef, index: number) {
  return listings
    .filter((each) => symbolKey(each) !== symbolKey(symbol))
    .toSpliced(index, 0, symbol);
}

/**
 * One market's part of the watchlist, in the user's order, which they set by dragging a row or
 * its handle. A row drops only among its own market's, since each market is a list of its own.
 */
function MarketWatchlist({
  market,
  listings,
  removing,
  onMove,
  onRemove,
}: {
  market: Market;
  listings: SymbolRef[];
  removing: boolean;
  /** Puts `symbol` before or after `target`, another of this market's listings. */
  onMove: (symbol: SymbolRef, target: SymbolRef, after: boolean) => void;
  onRemove: (symbol: SymbolRef) => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

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
      const symbol = listings.find((each) => symbolKey(each) === key);
      const at = listings.find((each) => symbolKey(each) === target.key);

      if (symbol && at) onMove(symbol, at, target.dropPosition === "after");
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

  return (
    // The watchlist has no limit, and each row draws a chart: only the rows in view are rendered.
    <Virtualizer layout={ListLayout} layoutOptions={{ estimatedRowSize: 68 }}>
      <GridList
        aria-label={t("watchlist.market-list", {
          market: t(`market.${market}`),
        })}
        items={listings.map((symbol) => ({ id: symbolKey(symbol), symbol }))}
        dragAndDropHooks={dragAndDropHooks}
        className="outline-none">
        {({ symbol }) => (
          <GridListItem
            textValue={symbol.symbol}
            className="group relative outline-none data-[dragging]:opacity-40 data-[focus-visible]:[&>a]:bg-default">
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
              isDisabled={removing}
              className="absolute top-1 right-2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"
              onPress={() => onRemove(symbol)}
            />
          </GridListItem>
        )}
      </GridList>
    </Virtualizer>
  );
}

/** Lights up each listing added to `listings` once its row is drawn in the element the ref is set on. */
function useAddedHighlight(listings: readonly SymbolRef[] | undefined) {
  const { accent } = usePaletteColors();
  const list = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string> | undefined>(undefined);

  // A listing added from its chart lights up where it lands, which is often far from the button.
  useEffect(() => {
    if (!listings) return;

    const before = seen.current;
    const keys = listings.map(symbolKey);

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
  }, [listings, accent]);

  return list;
}

/**
 * The listings the user watches in `market`, or in every market with each under its own heading
 * once there are more than one.
 */
export function Watchlist({ market }: { market: Market | null }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data, error, refetch } = useQuery(watchlistQuery());
  const list = useAddedHighlight(data);

  const remove = useMutation(orpc.watchlist.remove.mutationOptions());

  // The row lands where it was dropped at once; the main process's order replaces it once saved,
  // and a move that failed pushes nothing, so the list is read again either way.
  const move = useMutation(
    orpc.watchlist.move.mutationOptions({
      onMutate: async ({ symbol, index }) => {
        await queryClient.cancelQueries({ queryKey: orpc.watchlist.key() });

        queryClient.setQueryData(
          watchlistQuery().queryKey,
          (current) => current && moved(current, symbol, index)
        );
      },
      onSettled: () =>
        queryClient.invalidateQueries({ queryKey: orpc.watchlist.key() }),
    })
  );

  if (error) {
    return (
      <div>
        <LoadError error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  if (!data) return <LoadingState />;

  const markets = groupByMarket(data, (symbol) => symbol.market, market);

  if (markets.length === 0) {
    return (
      <p className="rounded-sm pencil px-4 py-3 text-xs text-muted">
        {market && data.length > 0
          ? t("watchlist.empty-market", { market: t(`market.${market}`) })
          : t("watchlist.empty")}
      </p>
    );
  }

  // The order is one across markets, so a row dropped by another of its market's lands beside it there.
  const onMove = (symbol: SymbolRef, target: SymbolRef, after: boolean) => {
    const others = data.filter((each) => symbolKey(each) !== symbolKey(symbol));

    const at = others.findIndex(
      (each) => symbolKey(each) === symbolKey(target)
    );

    if (at >= 0) move.mutate({ symbol, index: after ? at + 1 : at });
  };

  const actionError = remove.error ?? move.error;

  return (
    <div ref={list}>
      <MarketGroups groups={markets}>
        {({ market: each, items }) => (
          <MarketWatchlist
            market={each}
            listings={items}
            removing={remove.isPending}
            onMove={onMove}
            onRemove={(symbol) => remove.mutate(symbol)}
          />
        )}
      </MarketGroups>
      {actionError ? (
        <div className="pt-2">
          <ErrorAlert
            title={t("watchlist.update-failed")}
            description={actionError.message}
          />
        </div>
      ) : null}
    </div>
  );
}
