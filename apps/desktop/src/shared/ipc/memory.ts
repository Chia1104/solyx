import type { Memory, MemoryChange } from "@solyx/core/memory";

export interface MemoryApi {
  /** Most recently written first. */
  list(): Promise<Memory[]>;
  /** Rewrites a memory's description and body; rejects once it is forgotten. */
  update(id: string, change: MemoryChange): Promise<Memory>;
  forget(id: string): Promise<void>;
}

/** Pushes from the main process; each subscription returns a function that stops listening. */
export interface MemoryEvents {
  /** A memory was saved, rewritten or forgotten: by the agent, in any window or by clearing them. */
  onChanged(listener: () => void): () => void;
}

export const memoryChannels = {
  list: "memory:list",
  update: "memory:update",
  forget: "memory:forget",
} as const satisfies Record<keyof MemoryApi, string>;

export const memoryEvents = {
  onChanged: "memory:changed",
} as const satisfies Record<keyof MemoryEvents, string>;
