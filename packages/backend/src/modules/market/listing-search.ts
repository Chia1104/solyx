import type { ListingMatch } from "@solyx/api/market";
import { Market } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { Listing } from "@solyx/core/market-data";

/** The most listings a search returns. */
const MAX_MATCHES = 20;

// A US ticker is letters, with a dot or a hyphen before a class of shares, as in BRK.B.
const US_TICKER = /^[A-Z][A-Z.-]{0,9}$/;

/** A listing a market's directory holds, with the names a search matches. */
export interface ListingEntry {
  symbol: string;
  name: string;
  englishName: string | null;
}

export interface ListingSearchSources {
  /** Every listing of a market the search matches against. */
  directory: (market: Market) => Promise<ListingEntry[]>;
  /** One listing by its code, for a US ticker its market's directory does not hold. */
  listing: (symbol: SymbolRef) => Promise<Listing | null>;
}

interface Ranked {
  /** Best at 0: the code typed whole, then the start of a code, the start of a name, a name holding it. */
  order: number;
  match: ListingMatch;
}

function rank({ symbol, name, englishName }: ListingEntry, query: string) {
  const code = query.toUpperCase();

  if (symbol === code) return 0;

  if (symbol.startsWith(code)) return 1;

  const typed = query.toLowerCase();

  const names = [name, englishName ?? ""].map((each) => each.toLowerCase());

  if (names.some((each) => each.startsWith(typed))) return 2;

  return names.some((each) => each.includes(typed)) ? 3 : undefined;
}

async function searchMarket(
  market: Market,
  query: string,
  { directory, listing }: ListingSearchSources
): Promise<Ranked[]> {
  const ranked = (await directory(market)).flatMap((entry): Ranked[] => {
    const order = rank(entry, query);

    return order === undefined
      ? []
      : [
          {
            order,
            match: {
              symbol: { market, symbol: entry.symbol },
              name: entry.name,
              englishName: entry.englishName,
            },
          },
        ];
  });

  const ticker = query.toUpperCase();

  // A US listing the directory lacks, as one traded over the counter, is found by its whole ticker.
  if (
    market === Market.US &&
    US_TICKER.test(ticker) &&
    !ranked.some(({ order }) => order === 0)
  ) {
    const symbol = { market, symbol: ticker };
    const found = await listing(symbol);

    if (found) ranked.push({ order: 0, match: { symbol, ...found } });
  }

  return ranked;
}

/**
 * Listings matching `query`, best first, in `market` or in every market where it is `null`. A
 * market whose source fails leaves the others' matches standing; rejects only when every market
 * asked fails.
 */
export async function searchListings(
  { query, market }: { query: string; market: Market | null },
  sources: ListingSearchSources
): Promise<ListingMatch[]> {
  const settled = await Promise.allSettled(
    (market === null ? Object.values(Market) : [market]).map((each) =>
      searchMarket(each, query, sources)
    )
  );

  const failure = settled.find((result) => result.status === "rejected");

  if (failure && settled.every((result) => result.status === "rejected")) {
    throw failure.reason;
  }

  return settled
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .toSorted(
      (a, b) =>
        a.order - b.order ||
        a.match.symbol.symbol.localeCompare(b.match.symbol.symbol)
    )
    .slice(0, MAX_MATCHES)
    .map(({ match }) => match);
}
