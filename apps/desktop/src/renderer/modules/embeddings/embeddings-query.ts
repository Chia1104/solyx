import type { QueryClient } from "@tanstack/react-query";

import { LocalModelStatus } from "#shared/embeddings.ts";

import { client, forEachEvent, orpc } from "../../app/rpc.ts";

// Opening Ollama or pulling in a terminal pushes nothing, so a model not there yet is looked for again.
const LOOK_AGAIN_MS = 5 * 1000;

/** Read again on every push, and every few seconds while Ollama is closed or lacks the model. */
export const localModelQuery = () =>
  orpc.embeddings.localModel.queryOptions({
    refetchInterval: ({ state }) =>
      state.data?.status === LocalModelStatus.Unreachable ||
      state.data?.status === LocalModelStatus.Missing
        ? LOOK_AGAIN_MS
        : false,
  });

/** Refetches Ollama's model whenever a pull moves on or the settings naming it change. */
export function followEmbeddingsChanges(queryClient: QueryClient) {
  void forEachEvent(client.embeddings.changes(), () => {
    void queryClient.invalidateQueries({ queryKey: orpc.embeddings.key() });
  });
}
