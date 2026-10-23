import { omit } from "es-toolkit";

import { contractOS } from "../../rpc/context.ts";

export const memoryRouter = contractOS.memory.router({
  list: contractOS.memory.list.handler(({ context }) =>
    context.memories.store.list()
  ),
  // The user's edit keeps the memory's kind, listing and the conversation that wrote it.
  update: contractOS.memory.update.handler(({ context, input }) => {
    const { store } = context.memories;
    const [memory] = store.read([input.id]);

    if (!memory) throw new Error("That memory was forgotten");

    return store.save(
      { ...omit(memory, ["createdAt", "updatedAt"]), ...input.change },
      Date.now()
    );
  }),
  forget: contractOS.memory.forget.handler(({ context, input }) => {
    context.memories.store.forget(input);
  }),
  changes: contractOS.memory.changes.handler(({ context, signal }) =>
    context.windowEvents.subscribe("memory:changed", { signal })
  ),
});
