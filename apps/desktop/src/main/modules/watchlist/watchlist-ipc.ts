import * as z from "zod";

import { symbolRefSchema } from "@solyx/core/market";

import { watchlistChannels } from "#shared/ipc/watchlist.ts";
import type { WatchlistApi } from "#shared/ipc/watchlist.ts";

import { ipcModule } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

const handle = ipcModule<WatchlistApi>(watchlistChannels, {
  list: z.tuple([]),
  add: z.tuple([symbolRefSchema]),
  remove: z.tuple([symbolRefSchema]),
});

export function registerWatchlistIpc({ userData }: Services) {
  handle("list", async () => userData.watchlist.list());
  handle("add", async (symbol) => userData.watchlist.add(symbol));
  handle("remove", async (symbol) => userData.watchlist.remove(symbol));
}
