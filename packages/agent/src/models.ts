import { createModels } from "@earendil-works/pi-ai";
import type { AuthContext, Models } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";

// Keys come only from what the user saved in the app, never from the environment or files.
const NO_AMBIENT_AUTH: AuthContext = {
  env: async () => undefined,
  fileExists: async () => false,
};

/** The providers' model catalogs. Requests carry the user's key explicitly. */
export function createModelCatalog(): Models {
  const models = createModels({ authContext: NO_AMBIENT_AUTH });

  models.setProvider(anthropicProvider());
  models.setProvider(openaiProvider());
  models.setProvider(googleProvider());
  models.setProvider(openrouterProvider());

  return models;
}
