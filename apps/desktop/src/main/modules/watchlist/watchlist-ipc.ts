import * as z from "zod";

import { symbolRefSchema } from "@solyx/core/market";

import { watchlistChannels } from "#shared/ipc/watchlist.ts";
import type { WatchlistApi } from "#shared/ipc/watchlist.ts";

import { bindIpc } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

const schemas = {
  list: z.tuple([]),
  add: z.tuple([symbolRefSchema]),
  remove: z.tuple([symbolRefSchema]),
  move: z.tuple([symbolRefSchema, z.number().int().nonnegative()]),
};

export function registerWatchlistIpc({ userData }: Services) {
  bindIpc<WatchlistApi>(watchlistChannels, schemas, {
    list: async () => userData.watchlist.list(),
    add: async (symbol) => userData.watchlist.add(symbol),
    remove: async (symbol) => userData.watchlist.remove(symbol),
    move: async (symbol, index) => userData.watchlist.move(symbol, index),
  });
}
