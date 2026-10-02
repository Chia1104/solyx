import { createModels } from "@earendil-works/pi-ai";
import type {
  AuthContext,
  CredentialStore,
  Models,
  OAuthAuth,
} from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";

// Keys come only from what the user saved in the app, never from the environment or files.
const NO_AMBIENT_AUTH: AuthContext = {
  env: async () => undefined,
  fileExists: async () => false,
};

/**
 * The providers' model catalogs. A request on an API key carries it explicitly; one on a
 * subscription resolves and refreshes its OAuth credential through `credentials`. OpenAI signs
 * in with `chatgpt`, the app's own flow from `chatgptOAuth`, in place of pi-ai's.
 */
export function createModelCatalog(
  credentials: CredentialStore,
  chatgpt: OAuthAuth
): Models {
  const models = createModels({ credentials, authContext: NO_AMBIENT_AUTH });
  const openai = openaiProvider();

  models.setProvider(anthropicProvider());
  models.setProvider({ ...openai, auth: { ...openai.auth, oauth: chatgpt } });
  models.setProvider(googleProvider());
  models.setProvider(openrouterProvider());

  return models;
}
