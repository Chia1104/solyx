import { cn } from "@heroui/react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { SymbolRef } from "@solyx/core/market";
import type { Listing } from "@solyx/core/market-data";

import { Locale } from "#shared/ipc/settings.ts";

import { marketDataQuery } from "../settings/settings-query.ts";

import { listingQuery } from "./listing-query.ts";

/** Exchanges name listings in their own language; the English name is used when there is one. */
export function listingName(
  listing: Listing | null | undefined,
  locale: string
): string | undefined {
  return locale === Locale.EnUS
    ? (listing?.englishName ?? listing?.name)
    : listing?.name;
}

/**
 * Listings' names in the app's language, in their order. Each is asked for only once its
 * market's source has its settings, since a miss is kept for the rest of the session.
 */
export function useListingNames(
  symbols: readonly SymbolRef[]
): (string | undefined)[] {
  const { i18n } = useTranslation();
  const settings = useQuery(marketDataQuery());

  const listings = useQueries({
    queries: symbols.map((symbol) => ({
      ...listingQuery(symbol),
      enabled: settings.data?.markets[symbol.market]?.ready === true,
    })),
  });

  return listings.map((listing) => listingName(listing.data, i18n.language));
}

export function useListingName(symbol: SymbolRef): string | undefined {
  return useListingNames([symbol])[0];
}

/** A listing's name beside its code, truncated before the code is; nothing until it is known. */
export function ListingName({
  symbol,
  className,
}: {
  symbol: SymbolRef;
  className?: string;
}) {
  const name = useListingName(symbol);

  return name ? (
    <span className={cn("min-w-0 truncate", className)}>{name}</span>
  ) : null;
}
