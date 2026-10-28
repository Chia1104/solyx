import { useDeferredValue, useState } from "react";

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
import { useRecentListings } from "./recent-listings.ts";

// The filter that leaves every market in.
const EVERY_MARKET = "all";

interface Found {
  symbol: SymbolRef;
  name: string | undefined;
}

/** Where the title bar's search sits: it opens the search over the page. */
export function ListingSearchButton({
  hotkey,
  onPress,
}: {
  hotkey: Hotkey;
  onPress: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Button
      aria-label={t("search.title")}
      className="flex h-9 w-56 items-center gap-2 rounded-field bg-field px-3 text-sm text-field-placeholder shadow-field outline-none hover:bg-field-hover focus-visible:status-focused-field"
      onPress={onPress}>
      <Icon icon={Search01Icon} />
      <span className="flex-1 truncate text-left">{t("search.trigger")}</span>
      <Kbd>
        <Kbd.Content>{formatForDisplay(hotkey, {})}</Kbd.Content>
      </Kbd>
    </Button>
  );
}

/**
 * Finds a listing by its code or name, in every market or the one picked, and opens its page. A
 * US listing is found by its full ticker; before anything is typed it offers the listings last
 * opened from it.
 */
export function ListingSearchDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Modal.Backdrop
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}>
      <Modal.Container size="md">
        <Modal.Dialog aria-label={t("search.title")} className="gap-3">
          {/* Mounted only while open, so each search starts empty. */}
          {isOpen ? <ListingSearch onOpened={onClose} /> : null}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

/** What the search offers: the listings matching what was typed, or before anything is, those opened last. */
function useFound(typed: string, market: Market | null) {
  const { i18n } = useTranslation();
  const recent = useRecentListings((state) => state.listings);
  const recentNames = useListingNames(recent);

  const search = useQuery({
    ...orpc.market.search.queryOptions({ input: { query: typed, market } }),
    enabled: typed !== "",
    placeholderData: keepPreviousData,
  });

  const found: Found[] =
    typed === ""
      ? recent.flatMap((symbol, index) =>
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

function MarketFilter({
  market,
  onChange,
}: {
  market: Market | null;
  onChange: (market: Market | null) => void;
}) {
  const { t } = useTranslation();

  return (
    <ToggleButtonGroup
      aria-label={t("search.markets")}
      selectionMode="single"
      disallowEmptySelection
      size="sm"
      selectedKeys={[market ?? EVERY_MARKET]}
      onSelectionChange={(keys) => {
        const [key] = keys;

        onChange(isEnumValue(Market, key) ? key : null);
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

/** What is found, or why nothing is, and where US listings stand. */
function Results({
  typed,
  market,
  onOpen,
}: {
  typed: string;
  market: Market | null;
  onOpen: (symbol: SymbolRef) => void;
}) {
  const { t } = useTranslation();
  const sources = useMarketSources();
  const { found, search } = useFound(typed, market);
  const recent = typed === "";

  // Nothing is said while a search is under way, since its answer replaces the last one's.
  const nothing = recent
    ? t("search.hint")
    : (search.error?.message ?? (search.isFetching ? null : t("search.none")));

  const usSignedOut =
    market !== Market.TW && sources.data?.[Market.US].ready === false;

  return (
    <>
      {recent && found.length > 0 ? (
        <p className="text-xs text-muted">{t("search.recent")}</p>
      ) : null}
      {found.length > 0 ? (
        <FoundList found={found} onOpen={onOpen} />
      ) : (
        <p className="py-6 text-center text-sm text-muted">{nothing}</p>
      )}
      {usSignedOut ? (
        <p className="text-xs text-muted">{t("search.us-signed-out")}</p>
      ) : null}
    </>
  );
}

function ListingSearch({ onOpened }: { onOpened: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [market, setMarket] = useState<Market | null>(null);
  const typed = useDeferredValue(query.trim());
  const remember = useRecentListings((state) => state.remember);

  function open(symbol: SymbolRef) {
    remember(symbol);
    void navigate({
      to: "/symbol/$market/$symbol",
      params: { market: symbol.market, symbol: symbol.symbol },
      search: true,
    });
    onOpened();
  }

  return (
    <Autocomplete inputValue={query} onInputChange={setQuery}>
      <SearchField autoFocus aria-label={t("search.title")} className="w-full">
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input placeholder={t("chart.search-placeholder")} />
          <SearchField.ClearButton />
        </SearchField.Group>
      </SearchField>
      <MarketFilter market={market} onChange={setMarket} />
      <Results typed={typed} market={market} onOpen={open} />
    </Autocomplete>
  );
}
