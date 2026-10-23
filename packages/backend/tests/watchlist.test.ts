import { expect, test, vi } from "vite-plus/test";

import { Market } from "@solyx/core/market";

import { createWatchlist } from "../src/modules/watchlist/watchlist.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

test("every change tells the listener, and reading the list does not", () => {
  const store = {
    list: vi.fn(() => [TSMC]),
    add: vi.fn(),
    remove: vi.fn(),
    move: vi.fn(),
    clear: vi.fn(),
  };

  const onChange = vi.fn();
  const watchlist = createWatchlist({ store, onChange });

  expect(watchlist.list()).toEqual([TSMC]);
  expect(onChange).not.toHaveBeenCalled();

  watchlist.add(TSMC);
  watchlist.move(TSMC, 0);
  watchlist.remove(TSMC);
  watchlist.clear();

  expect(store.add).toHaveBeenCalledWith(TSMC);
  expect(store.move).toHaveBeenCalledWith(TSMC, 0);
  expect(store.remove).toHaveBeenCalledWith(TSMC);
  expect(store.clear).toHaveBeenCalledOnce();
  expect(onChange).toHaveBeenCalledTimes(4);
});
