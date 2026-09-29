import { and, asc, eq } from "drizzle-orm";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";

import type { SymbolRef } from "@solyx/core/market";

import { connect } from "./connection.ts";
import { watchlist } from "./user-schema.ts";

function watchlistStore(db: NodeSQLiteDatabase) {
  const listing = (ref: SymbolRef) =>
    and(eq(watchlist.market, ref.market), eq(watchlist.symbol, ref.symbol));

  return {
    /** Watched listings in the order they were added. */
    list: (): SymbolRef[] =>
      db
        .select({ market: watchlist.market, symbol: watchlist.symbol })
        .from(watchlist)
        .orderBy(asc(watchlist.id))
        .all(),

    /** Appends a listing; one already watched keeps its place. */
    add(ref: SymbolRef) {
      db.insert(watchlist).values(ref).onConflictDoNothing().run();
    },

    remove(ref: SymbolRef) {
      db.delete(watchlist).where(listing(ref)).run();
    },
  };
}

export type WatchlistStore = ReturnType<typeof watchlistStore>;

/**
 * The user's database, holding what cannot be fetched again. It is never deleted, so a
 * file its migrations cannot open is an error. `migrationsFolder` is `migrations/user`
 * wherever the host ships it.
 */
export function openUserData(path: string, migrationsFolder: string) {
  const connection = connect(path, migrationsFolder);

  return {
    watchlist: watchlistStore(connection.db),
    close: () => connection.client.close(),
  };
}

export type UserData = ReturnType<typeof openUserData>;
