import type { UserData } from "@solyx/db/user";

export interface WatchlistOptions {
  store: UserData["watchlist"];
  /** Called after every change, so whoever shows the list can read it again. */
  onChange: () => void;
}

/**
 * The listings the user watches, telling its listener of every change whoever made it: a window,
 * the agent or clearing them all.
 */
export function createWatchlist({ store, onChange }: WatchlistOptions) {
  const telling =
    <Args extends unknown[]>(write: (...args: Args) => void) =>
    (...args: Args) => {
      write(...args);
      onChange();
    };

  return {
    list: store.list,
    add: telling(store.add),
    remove: telling(store.remove),
    move: telling(store.move),
    clear: telling(store.clear),
  };
}

export type Watchlist = ReturnType<typeof createWatchlist>;
