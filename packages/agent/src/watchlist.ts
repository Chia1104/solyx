import { defineExtension } from "@earendil-works/pi-durable";
import type { Extension, ToolRegistration } from "@earendil-works/pi-durable";
import { uniqBy } from "es-toolkit";
import * as z from "zod";

import { symbolKey, symbolLabel } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { MarketData } from "@solyx/core/market-data";

import type { ToolGuard } from "./approval.ts";
import { defineTool } from "./tools.ts";
import { AgentToolName, changeWatchlistArgumentsSchema } from "./wire.ts";

/** The host's watchlist as the agent reads and changes it. */
export interface WatchlistPort {
  /** In the user's order. */
  list(): SymbolRef[];
  /** One already watched keeps its place. */
  add(symbol: SymbolRef): void;
  remove(symbol: SymbolRef): void;
}

export interface WatchlistToolsOptions {
  watchlist: WatchlistPort;
  /** Names a listing, so a code no source lists is told from one that exists. */
  marketData: Pick<MarketData, "listing">;
}

type WatchlistChange = z.infer<typeof changeWatchlistArgumentsSchema>;

const codes = (listings: readonly SymbolRef[]) =>
  listings.map(symbolLabel).join(", ");

/**
 * `change_watchlist`: the agent's way to add listings to the user's watchlist and take them off,
 * once the user allows it. `get_watchlist` reads it with the trading tools.
 */
export function createWatchlistTools({
  watchlist,
  marketData,
}: WatchlistToolsOptions) {
  /** What a call would change, each listing once, and what is already as it asks. */
  function planned({ add, remove }: WatchlistChange) {
    const watched = new Set(watchlist.list().map(symbolKey));
    const dropped = new Set(remove.map(symbolKey));
    const both = add.filter((symbol) => dropped.has(symbolKey(symbol)));

    if (both.length > 0) {
      throw new Error(`${codes(both)} cannot be both added and removed`);
    }

    const [adding, removing] = [
      add.filter((symbol) => !watched.has(symbolKey(symbol))),
      remove.filter((symbol) => watched.has(symbolKey(symbol))),
    ].map((listings) => uniqBy(listings, symbolKey));

    return {
      adding,
      removing,
      alreadyWatched: add.filter((symbol) => watched.has(symbolKey(symbol))),
      notWatched: remove.filter((symbol) => !watched.has(symbolKey(symbol))),
    };
  }

  /** Each listing with the exchange's name for it, refusing a code no source lists. */
  async function named(listings: readonly SymbolRef[]): Promise<string[]> {
    return Promise.all(
      listings.map(async (symbol) => {
        const listing = await marketData.listing(symbol);

        if (!listing) {
          throw new Error(
            `No market data source lists ${symbolLabel(symbol)}, so it cannot be told from a mistyped code. Check the code and its market.`
          );
        }

        return `${symbolLabel(symbol)} ${listing.name}`;
      })
    );
  }

  const unchanged = ({
    alreadyWatched,
    notWatched,
  }: ReturnType<typeof planned>) => [
    ...(alreadyWatched.length > 0
      ? [`Already watched: ${codes(alreadyWatched)}.`]
      : []),
    ...(notWatched.length > 0
      ? [`Not watched, so nothing to remove: ${codes(notWatched)}.`]
      : []),
  ];

  const changeWatchlist = defineTool({
    name: AgentToolName.ChangeWatchlist,
    // Adding a listing already watched and removing one that is not both change nothing.
    replay: "safe",
    description:
      "Adds listings to the user's watchlist and takes listings off it, once the user allows it. The app collects news for every watched listing, runs the tasks that wait on a change for them, and suggests them after @. A listing already as you ask is left alone and said so.",
    parameters: changeWatchlistArgumentsSchema,
    async execute(change) {
      const plan = planned(change);
      const added = await named(plan.adding);

      for (const symbol of plan.adding) watchlist.add(symbol);

      for (const symbol of plan.removing) watchlist.remove(symbol);

      return {
        text: [
          ...(added.length > 0 ? [`Now watching: ${added.join(", ")}.`] : []),
          ...(plan.removing.length > 0
            ? [`No longer watching: ${codes(plan.removing)}.`]
            : []),
          ...unchanged(plan),
          ...(plan.adding.length + plan.removing.length === 0
            ? ["The watchlist is as it was."]
            : []),
        ].join("\n"),
        details: {
          added: plan.adding,
          removed: plan.removing,
        },
      };
    },
  });

  /**
   * Checks a call before the user is asked, and lets one that would change nothing answer without
   * asking, so they are never asked about a call that cannot run or does nothing.
   */
  function asking(guarded: ToolRegistration): ToolRegistration {
    return {
      ...guarded,
      async execute(params, api, context) {
        const parsed = changeWatchlistArgumentsSchema.safeParse(params);

        if (!parsed.success) throw new Error(z.prettifyError(parsed.error));

        const plan = planned(parsed.data);

        await named(plan.adding);

        return plan.adding.length + plan.removing.length === 0
          ? changeWatchlist.execute(params, api, context)
          : guarded.execute(params, api, context);
      },
    };
  }

  return {
    /** A change waits for the user through `guard`. */
    extension: (guard: ToolGuard): Extension =>
      defineExtension({
        name: "solyx-watchlist",
        tools: [asking(guard(changeWatchlist))],
      }),
  };
}
