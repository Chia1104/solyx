import * as z from "zod";

/** What the storage page measures and clears, each cleared as a whole. */
export const StoredData = {
  Candles: "candles",
  Conversations: "conversations",
  Memory: "memory",
  News: "news",
  Watchlist: "watchlist",
} as const;

export type StoredData = (typeof StoredData)[keyof typeof StoredData];

export const storedDataSchema = z.enum(StoredData);

/** What the candle cache holds for one provider, by its `id`. */
export interface CacheSourceUsage {
  source: string;
  series: number;
  bars: number;
}

export interface CacheUsage {
  /** On disk, with the write-ahead log. */
  bytes: number;
  sources: CacheSourceUsage[];
}

export interface ConversationsUsage {
  /** On disk, with the folders the conversations' shell commands work in. */
  bytes: number;
  conversations: number;
}

export interface MemoryUsage {
  /** On disk, with the write-ahead log. */
  bytes: number;
  memories: number;
}

export interface NewsUsage {
  /** On disk, with the write-ahead log. */
  bytes: number;
  /** Each counted once, however many listings it was found for. */
  items: number;
}

export interface WatchlistUsage {
  listings: number;
}

export interface StorageUsage {
  candles: CacheUsage;
  conversations: ConversationsUsage;
  memory: MemoryUsage;
  news: NewsUsage;
  watchlist: WatchlistUsage;
}

export interface StorageApi {
  usage(): Promise<StorageUsage>;
  /**
   * Deletes everything of one kind and gives the space back to the disk. Charts fetch candles
   * again as they need them; the rest is gone for good, and conversations still running stop.
   */
  clear(data: StoredData): Promise<void>;
}

export const storageChannels = {
  usage: "storage:usage",
  clear: "storage:clear",
} as const satisfies Record<keyof StorageApi, string>;
