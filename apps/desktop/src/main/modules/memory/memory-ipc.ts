import { omit } from "es-toolkit";
import * as z from "zod";

import { memoryChangeSchema } from "@solyx/core/memory";

import { memoryChannels } from "#shared/ipc/memory.ts";
import type { MemoryApi } from "#shared/ipc/memory.ts";

import { bindIpc } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

const schemas = {
  list: z.tuple([]),
  update: z.tuple([z.string(), memoryChangeSchema]),
  forget: z.tuple([z.string()]),
};

export function registerMemoryIpc({ memories }: Services) {
  const { store } = memories;

  bindIpc<MemoryApi>(memoryChannels, schemas, {
    list: async () => store.list(),

    // The user's edit keeps the memory's kind, listing and the conversation that wrote it.
    async update(id, change) {
      const [memory] = store.read([id]);

      if (!memory) throw new Error("That memory was forgotten");

      return store.save(
        { ...omit(memory, ["createdAt", "updatedAt"]), ...change },
        Date.now()
      );
    },

    async forget(id) {
      store.forget(id);
    },
  });
}
