import type { Cache } from "@solyx/db/cache";
import type { NewsData } from "@solyx/db/news";
import type { UserData } from "@solyx/db/user";

import { StoredData } from "#shared/ipc/storage.ts";
import type { StorageApi } from "#shared/ipc/storage.ts";

import type { AgentService } from "../agent/agent-service.ts";
import type { Memories } from "../memory/memories.ts";
import type { Research } from "../research/research.ts";

export interface StorageApiOptions {
  cache: Pick<Cache, "usage" | "clear">;
  agent: Pick<AgentService, "sessionsUsage" | "deleteAllSessions">;
  memories: Pick<Memories, "usage" | "clear">;
  news: Pick<NewsData, "usage" | "clear">;
  research: Pick<Research, "usage" | "clear">;
  watchlist: Pick<UserData["watchlist"], "list" | "clear">;
}

/** The storage page's side of the main process, one method per `StorageApi` channel. */
export function createStorageApi({
  cache,
  agent,
  memories,
  news,
  research,
  watchlist,
}: StorageApiOptions): StorageApi {
  const clear: Record<StoredData, () => Promise<void>> = {
    [StoredData.Candles]: async () => cache.clear(),
    [StoredData.Conversations]: () => agent.deleteAllSessions(),
    [StoredData.Memory]: async () => memories.clear(),
    [StoredData.News]: async () => news.clear(),
    [StoredData.Research]: async () => research.clear(),
    [StoredData.Watchlist]: async () => watchlist.clear(),
  };

  return {
    usage: async () => ({
      candles: cache.usage(),
      conversations: await agent.sessionsUsage(),
      memory: memories.usage(),
      news: news.usage(),
      research: research.usage(),
      watchlist: { listings: watchlist.list().length },
    }),

    clear: (data) => clear[data](),
  };
}
