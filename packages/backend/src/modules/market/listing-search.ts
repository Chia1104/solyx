import type { ListingMatch } from "@solyx/api/market";
import type { Listed, ListingName } from "@solyx/core/fundamentals";
import { Market } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { Listing } from "@solyx/core/market-data";

/** The most Taiwan listings a search returns. */
const MAX_MATCHES = 20;

// A US ticker is letters, with a dot or a hyphen before a class of shares, as in BRK.B.
const US_TICKER = /^[A-Z][A-Z.-]{0,9}$/;

export interface ListingSearchSources {
  /** Every listing of a market with the name its exchanges quote it under. */
  names: (market: Market) => Promise<Listed<ListingName>[]>;
  listing: (symbol: SymbolRef) => Promise<Listing | null>;
}

/** How well a listing matches what was typed, best at 0: its code, then the start of its name, then anywhere in it. */
function rank(code: string, name: string, query: string): number | undefined {
  const upper = query.toUpperCase();

  if (code === upper) return 0;

  if (code.startsWith(upper)) return 1;

  const lower = name.toLowerCase();
  const typed = query.toLowerCase();

  if (lower.startsWith(typed)) return 2;

  return lower.includes(typed) ? 3 : undefined;
}

async function taiwan(
  query: string,
  { names }: ListingSearchSources
): Promise<ListingMatch[]> {
  return (await names(Market.TW))
    .flatMap(({ symbol, name }) => {
      const order = rank(symbol, name, query);

      return order === undefined ? [] : [{ order, symbol, name }];
    })
    .toSorted((a, b) => a.order - b.order || a.symbol.localeCompare(b.symbol))
    .slice(0, MAX_MATCHES)
    .map(({ symbol, name }) => ({
      symbol: { market: Market.TW, symbol },
      name,
      englishName: null,
    }));
}

// The US source names a listing only by its full ticker, so a US search finds one or none.
async function us(
  query: string,
  { listing }: ListingSearchSources
): Promise<ListingMatch[]> {
  const ticker = query.toUpperCase();

  if (!US_TICKER.test(ticker)) return [];

  const symbol = { market: Market.US, symbol: ticker };
  const found = await listing(symbol);

  return found ? [{ symbol, ...found }] : [];
}

/**
 * Listings matching `query`, the US one first since a full ticker matches it exactly: in `market`,
 * or in every market where it is `null`. A market whose source fails leaves the other's matches
 * standing; rejects only when every market asked fails.
 */
export async function searchListings(
  { query, market }: { query: string; market: Market | null },
  sources: ListingSearchSources
): Promise<ListingMatch[]> {
  const searches = [
    ...(market === null || market === Market.US ? [us(query, sources)] : []),
    ...(market === null || market === Market.TW
      ? [taiwan(query, sources)]
      : []),
  ];

  const settled = await Promise.allSettled(searches);

  const found = settled.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
  );

  const failure = settled.find((result) => result.status === "rejected");

  if (failure && settled.every((result) => result.status === "rejected")) {
    throw failure.reason;
  }

  return found;
}
