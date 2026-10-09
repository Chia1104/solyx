import { useQuery } from "@tanstack/react-query";
import { uniqBy } from "es-toolkit";

import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import { accountQuery } from "../account/account-query.ts";
import { useListingNames } from "../market/listing-name.tsx";
import { agentSkillsQuery } from "../settings/settings-query.ts";
import { watchlistQuery } from "../watchlist/watchlist-query.ts";

/** Why a listing is one `@` offers. */
export const ListingOrigin = {
  OnScreen: "on-screen",
  Held: "held",
  Watched: "watched",
} as const;

export type ListingOrigin = (typeof ListingOrigin)[keyof typeof ListingOrigin];

export interface MentionableListing {
  symbol: SymbolRef;
  origin: ListingOrigin;
  /** In the app's language, once the exchange's name is known. */
  name?: string;
}

/**
 * The listings `@` may name, as the main process resolves them: the one on screen, then those
 * held, then those watched, each once.
 */
export function useMentionableListings(
  focus: SymbolRef | null
): MentionableListing[] {
  const watchlist = useQuery(watchlistQuery());
  const account = useQuery(accountQuery());

  const listings = uniqBy(
    [
      ...(focus ? [{ symbol: focus, origin: ListingOrigin.OnScreen }] : []),
      ...(account.data?.positions ?? []).map((position) => ({
        symbol: position.instrument,
        origin: ListingOrigin.Held,
      })),
      ...(watchlist.data ?? []).map((symbol) => ({
        symbol,
        origin: ListingOrigin.Watched,
      })),
    ] satisfies MentionableListing[],
    (listing) => symbolKey(listing.symbol)
  );

  const names = useListingNames(listings.map((listing) => listing.symbol));

  return listings.map((listing, index) => ({
    ...listing,
    name: names[index],
  }));
}

/** The skills the user may ask for by starting a message with `/name`. */
export function useCommandSkills() {
  const { data } = useQuery(agentSkillsQuery());

  return (data?.skills ?? []).filter(
    (skill) => skill.offered && skill.userInvocable
  );
}
