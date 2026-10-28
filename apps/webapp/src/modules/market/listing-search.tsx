import {
  Kbd,
  ListBox,
  Modal,
  SearchField,
  ToggleButton,
  ToggleButtonGroup,
} from "@heroui/react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { formatForDisplay } from "@tanstack/react-hotkeys";
import type { Hotkey } from "@tanstack/react-hotkeys";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Autocomplete, Button } from "react-aria-components";
import { useTranslation } from "react-i18next";

import { Market, symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { isEnumValue } from "@solyx/utils/is";

import { orpc } from "../../app/rpc.ts";
import { Icon } from "../../components/icon.tsx";
import { useMarketSources } from "../settings/settings-query.ts";

import { listingName, useListingNames } from "./listing-name.tsx";
import { useListingSearchStore } from "./listing-search-store.ts";

// The filter that leaves every market in.
const EVERY_MARKET = "all";

// A search goes out once typing pauses this long, rather than on every key.
const SEARCH_WAIT_MS = 200;

interface Found {
  symbol: SymbolRef;
  name: string | undefined;
}

/** Where the title bar's search sits: it opens the search over the page. */
export function ListingSearchButton({ hotkey }: { hotkey: Hotkey }) {
  const { t } = useTranslation();
  const open = useListingSearchStore((state) => state.open);

  return (
    <Button
      aria-label={t("search.title")}
      className="flex h-9 w-56 items-center gap-2 rounded-field bg-field px-3 text-sm text-field-placeholder shadow-field outline-none hover:bg-field-hover focus-visible:status-focused-field"
      onPress={open}>
      <Icon icon={Search01Icon} />
      <span className="flex-1 truncate text-left">{t("search.trigger")}</span>
      <Kbd>
        <Kbd.Content>{formatForDisplay(hotkey, {})}</Kbd.Content>
      </Kbd>
    </Button>
  );
}

/**
 * Finds a listing by its code or name, in every market or the one picked, and opens its page;
 * before anything is typed it offers the listings last opened from it.
 */
export function ListingSearchDialog() {
  const { t } = useTranslation();
  const isOpen = useListingSearchStore((state) => state.isOpen);
  const close = useListingSearchStore((state) => state.close);

  return (
    <Modal.Backdrop
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}>
      <Modal.Container size="md">
        <Modal.Dialog aria-label={t("search.title")} className="gap-3">
          {/* Mounted only while open, so its field takes focus each time. */}
          {isOpen ? <ListingSearch /> : null}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

/** What the search offers: the listings matching what was typed, or before anything is, those opened last. */
function useFound(typed: string, empty: boolean) {
  const { i18n } = useTranslation();
  const market = useListingSearchStore((state) => state.market);
  const recent = useListingSearchStore((state) => state.recent);
  const recentNames = useListingNames(recent);

  const search = useQuery({
    ...orpc.market.search.queryOptions({ input: { query: typed, market } }),
    enabled: typed !== "",
    placeholderData: keepPreviousData,
  });

  // A field with text in it never offers the recent listings, so Enter cannot open one of them.
  const found: Found[] =
    typed === ""
      ? (empty ? recent : []).flatMap((symbol, index) =>
          market === null || symbol.market === market
            ? [{ symbol, name: recentNames[index] }]
            : []
        )
      : (search.data ?? []).map((match) => ({
          symbol: match.symbol,
          name: listingName(match, i18n.language),
        }));

  return { found, search };
}

function MarketFilter() {
  const { t } = useTranslation();
  const market = useListingSearchStore((state) => state.market);
  const setMarket = useListingSearchStore((state) => state.setMarket);

  return (
    <ToggleButtonGroup
      aria-label={t("search.markets")}
      selectionMode="single"
      disallowEmptySelection
      size="sm"
      selectedKeys={[market ?? EVERY_MARKET]}
      onSelectionChange={(keys) => {
        const [key] = keys;

        setMarket(isEnumValue(Market, key) ? key : null);
      }}>
      <ToggleButton id={EVERY_MARKET} variant="ghost">
        {t("search.every-market")}
      </ToggleButton>
      {Object.values(Market).map((each) => (
        <ToggleButton key={each} id={each} variant="ghost">
          {t(`market.${each}`)}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

function FoundList({
  found,
  onOpen,
}: {
  found: Found[];
  onOpen: (symbol: SymbolRef) => void;
}) {
  const { t } = useTranslation();

  return (
    <ListBox
      aria-label={t("search.results")}
      items={found}
      className="max-h-80 overflow-y-auto"
      onAction={(key) => {
        const picked = found.find(({ symbol }) => symbolKey(symbol) === key);

        if (picked) onOpen(picked.symbol);
      }}>
      {({ symbol, name }) => (
        <ListBox.Item
          id={symbolKey(symbol)}
          textValue={`${symbol.symbol} ${name ?? ""}`}
          className="flex items-center gap-3 text-sm data-focused:bg-default">
          <span className="w-16 shrink-0 font-medium tabular-nums">
            {symbol.symbol}
          </span>
          <span className="min-w-0 flex-1 truncate text-muted">{name}</span>
          <span className="shrink-0 text-xs text-muted">
            {t(`market.${symbol.market}`)}
          </span>
        </ListBox.Item>
      )}
    </ListBox>
  );
}

/**
 * What a search goes out for: what is typed once typing pauses, or at once nothing as the field
 * is cleared, so the recent listings come back without waiting. `flush` sends it without waiting.
 */
function useTyped() {
  const query = useListingSearchStore((state) => state.query.trim());

  const [settled, debouncer] = useDebouncedValue(query, {
    wait: SEARCH_WAIT_MS,
  });

  return {
    query,
    typed: query === "" ? "" : settled,
    flush: () => debouncer.flush(),
  };
}

/** Why nothing is listed; nothing is said while a search is due, since its answer replaces the last one's. */
function Nothing({
  query,
  waiting,
  error,
}: {
  query: string;
  waiting: boolean;
  error: Error | null;
}) {
  const { t } = useTranslation();

  const said =
    query === ""
      ? t("search.hint")
      : (error?.message ?? (waiting ? null : t("search.none")));

  return <p className="py-6 text-center text-sm text-muted">{said}</p>;
}

/** Says US listings wait for the Longbridge sign-in, while the search reaches the US. */
function UsSignedOut() {
  const { t } = useTranslation();
  const sources = useMarketSources();
  const market = useListingSearchStore((state) => state.market);

  if (market === Market.TW || sources.data?.[Market.US].ready !== false) {
    return null;
  }

  return <p className="text-xs text-muted">{t("search.us-signed-out")}</p>;
}

/** What is found, or why nothing is, and where US listings stand. */
function Results({
  query,
  typed,
  onOpen,
}: {
  query: string;
  typed: string;
  onOpen: (symbol: SymbolRef) => void;
}) {
  const { t } = useTranslation();
  const { found, search } = useFound(typed, query === "");

  return (
    <>
      {query === "" && found.length > 0 ? (
        <p className="text-xs text-muted">{t("search.recent")}</p>
      ) : null}
      {found.length > 0 ? (
        <FoundList found={found} onOpen={onOpen} />
      ) : (
        <Nothing
          query={query}
          waiting={typed !== query || search.isFetching}
          error={search.error}
        />
      )}
      <UsSignedOut />
    </>
  );
}

function ListingSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const query = useListingSearchStore((state) => state.query);
  const setQuery = useListingSearchStore((state) => state.setQuery);
  const remember = useListingSearchStore((state) => state.remember);
  const close = useListingSearchStore((state) => state.close);
  const typing = useTyped();

  function open(symbol: SymbolRef) {
    remember(symbol);
    void navigate({
      to: "/symbol/$market/$symbol",
      params: { market: symbol.market, symbol: symbol.symbol },
      search: true,
    });
    close();
  }

  return (
    <Autocomplete inputValue={query} onInputChange={setQuery}>
      {/* Enter before any match is listed searches at once rather than after the pause. */}
      <SearchField
        autoFocus
        aria-label={t("search.title")}
        className="w-full"
        onSubmit={typing.flush}>
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input placeholder={t("chart.search-placeholder")} />
          <SearchField.ClearButton />
        </SearchField.Group>
      </SearchField>
      <MarketFilter />
      <Results query={typing.query} typed={typing.typed} onOpen={open} />
    </Autocomplete>
  );
}
