import { createModelCatalog } from "@solyx/agent/models";
import {
  AgentAuth,
  DEFAULT_MODEL,
  hasSubscription,
} from "@solyx/agent/providers";
import type { AgentProvider } from "@solyx/agent/providers";
import type { AgentModelChoice } from "@solyx/agent/runtime";

import { AGENT_PROVIDER_SECRET, SecretState } from "#shared/ipc/settings.ts";
import type { AgentSettings, Locale } from "#shared/ipc/settings.ts";

import { PRODUCT_NAME } from "../../product.ts";
import type { ConfigFile } from "../settings/config-file.ts";
import { createCredentialStore } from "../settings/credential-store.ts";
import type { SecretStore } from "../settings/secret-store.ts";
import { SignInFlow, signInPage } from "../settings/sign-in-page.ts";

/** How the config file says `provider` is paid for; a provider without a subscription runs on a key. */
export function agentAuth(
  config: ConfigFile,
  provider: AgentProvider
): AgentAuth {
  return hasSubscription(provider)
    ? config.read().agent.auth
    : AgentAuth.ApiKey;
}

export interface AgentModelsOptions {
  config: ConfigFile;
  secrets: SecretStore;
  /** This installation's stable id, which Sign in with ChatGPT requires. */
  getDeviceId: () => string;
  /** Opens a sign-in page in the system browser. */
  openExternal: (url: string) => void;
}

/**
 * The model the agent runs on and how it is paid for, as the config file, the saved keys and
 * subscription sign-ins pick them. A model the provider does not list reads as the provider's
 * default.
 */
export function createAgentModels({
  config,
  secrets,
  getDeviceId,
  openExternal,
}: AgentModelsOptions) {
  // pi-ai reads the sign-in or the key here for each request, as the config file says to pay.
  const credentials = createCredentialStore(
    secrets,
    (provider) => agentAuth(config, provider) === AgentAuth.Subscription
  );

  const catalog = createModelCatalog({
    credentials,
    // OpenAI shows it on the consent screen; development builds sign in under the same name.
    appName: PRODUCT_NAME,
    getDeviceId,
    openExternal,
  });

  const keySaved = async (provider: AgentProvider) =>
    (await secrets.state(AGENT_PROVIDER_SECRET[provider])) ===
    SecretState.Saved;

  function selection() {
    const { provider, model, thinking } = config.read().agent;

    return {
      provider,
      auth: agentAuth(config, provider),
      model: catalog.model(provider, model),
      thinking,
    };
  }

  return {
    models: catalog.models,

    async settings(): Promise<AgentSettings> {
      const { provider, auth, model, thinking } = selection();

      const subscription = hasSubscription(provider)
        ? { signedIn: await credentials.signedIn(provider) }
        : null;

      return {
        provider,
        model: model?.id ?? DEFAULT_MODEL[provider],
        thinking,
        auth,
        subscription,
        models: catalog.options(provider),
        ready:
          model !== undefined &&
          (auth === AgentAuth.Subscription
            ? subscription?.signedIn === true
            : await keySaved(provider)),
      };
    },

    async choice(): Promise<AgentModelChoice> {
      const { provider, auth, model, thinking } = selection();

      if (!model) {
        throw new Error(`Pick a model for ${provider} in Settings first`);
      }

      if (auth === AgentAuth.Subscription) {
        if (!(await credentials.signedIn(provider))) {
          throw new Error(`Sign in to ${provider} in Settings first`);
        }
      } else if (!(await keySaved(provider))) {
        throw new Error(`Save an API key for ${provider} in Settings first`);
      }

      return { model, thinking };
    },

    /** Resolves once the sign-in is saved, or quietly once it is cancelled; the page is written in `locale`. */
    signIn: (locale: Locale) =>
      catalog.signIn(selection().provider, (outcome, detail) =>
        signInPage(locale, SignInFlow.ChatGPT, outcome, detail)
      ),

    cancelSignIn: () => catalog.cancelSignIn(),

    signOut: () => catalog.signOut(selection().provider),
  };
}
