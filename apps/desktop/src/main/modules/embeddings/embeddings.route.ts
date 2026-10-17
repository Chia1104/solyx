import { contractOS } from "../../rpc/context.ts";

export const embeddingsRouter = contractOS.embeddings.router({
  localModel: contractOS.embeddings.localModel.handler(({ context }) =>
    context.embeddings.localModel()
  ),
  pullLocalModel: contractOS.embeddings.pullLocalModel.handler(({ context }) =>
    context.embeddings.pullLocalModel()
  ),
  changes: contractOS.embeddings.changes.handler(({ context, signal }) =>
    context.windowEvents.subscribe("embeddings:changed", { signal })
  ),
});
