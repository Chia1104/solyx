import { oc, type } from "@orpc/contract";

import type { LocalModelState } from "../embeddings.ts";

import { changesContract } from "./changes.ts";

export const embeddingsContract = {
  /** What Ollama has of the model the local settings name, whichever provider is picked. */
  localModel: oc.output(type<LocalModelState>()),
  /** Has Ollama download that model, unless it already is; how far it has come reaches `localModel`. */
  pullLocalModel: oc.output(type<void>()),
  /** A pull moved on, or the settings that name the model changed. */
  changes: changesContract,
};
