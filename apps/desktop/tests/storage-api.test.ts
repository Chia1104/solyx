import { expect, test, vi } from "vite-plus/test";

import { Market } from "@solyx/core/market";

import { StoredData } from "#shared/ipc/storage.ts";

import { createStorageApi } from "../src/main/modules/storage/storage-api.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

function setup() {
  const options = {
    cache: {
      usage: vi.fn(() => ({
        bytes: 3000,
        sources: [{ source: "fugle", series: 1, bars: 20 }],
      })),
      clear: vi.fn(),
    },
    agent: {
      sessionsUsage: vi.fn(async () => ({ bytes: 2000, conversations: 2 })),
      deleteAllSessions: vi.fn(async () => undefined),
    },
    memories: {
      usage: vi.fn(() => ({ bytes: 500, memories: 3 })),
      clear: vi.fn(),
    },
    news: {
      usage: vi.fn(() => ({ bytes: 1000, items: 5 })),
      clear: vi.fn(),
    },
    watchlist: { list: vi.fn(() => [TSMC]), clear: vi.fn() },
  };

  const clears = {
    [StoredData.Candles]: options.cache.clear,
    [StoredData.Conversations]: options.agent.deleteAllSessions,
    [StoredData.Memory]: options.memories.clear,
    [StoredData.News]: options.news.clear,
    [StoredData.Watchlist]: options.watchlist.clear,
  };

  return { api: createStorageApi(options), clears };
}

test("usage measures every kind of data", async () => {
  const { api } = setup();

  expect(await api.usage()).toEqual({
    candles: {
      bytes: 3000,
      sources: [{ source: "fugle", series: 1, bars: 20 }],
    },
    conversations: { bytes: 2000, conversations: 2 },
    memory: { bytes: 500, memories: 3 },
    news: { bytes: 1000, items: 5 },
    watchlist: { listings: 1 },
  });
});

test.each(Object.values(StoredData))(
  "clearing %s leaves the rest",
  async (data) => {
    const { api, clears } = setup();

    await api.clear(data);

    for (const [kind, clear] of Object.entries(clears)) {
      expect(clear, kind).toHaveBeenCalledTimes(kind === data ? 1 : 0);
    }
  }
);
