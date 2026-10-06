import type { MemoryStore } from "@solyx/core/memory";
import type { MemoryData } from "@solyx/db/memory";

/**
 * The memories as the main process shares them: every write, whether the agent's, the settings
 * page's or clearing them all, tells `onChange`, so every window reads them again.
 */
export function createMemories(data: MemoryData, onChange: () => void) {
  const store: MemoryStore = {
    ...data.store,

    save(draft, at) {
      const saved = data.store.save(draft, at);

      onChange();

      return saved;
    },

    forget(id) {
      const forgot = data.store.forget(id);

      if (forgot) onChange();

      return forgot;
    },
  };

  return {
    store,

    usage: () => data.usage(),

    clear() {
      data.clear();
      onChange();
    },
  };
}

export type Memories = ReturnType<typeof createMemories>;
