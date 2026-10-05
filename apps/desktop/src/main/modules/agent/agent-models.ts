import { createModelCatalog } from "@solyx/agent/models";
import {
  AgentAuth,
  AgentProvider,
  DEFAULT_MODEL,
  hasSubscription,
} from "@solyx/agent/providers";
import type { AgentModelPick } from "@solyx/agent/providers";
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
 * The providers the user switched on, the model new conversations start on and how each provider
 * is paid for, as the config file, the saved keys and subscription sign-ins pick them. A model a
 * provider does not list reads as that provider's default.
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

  /** Switched on by the user, or the default model's, which cannot be switched off. */
  function enabled(provider: AgentProvider) {
    const { agent } = config.read();

    return provider === agent.provider || agent.providers.includes(provider);
  }

  /** The provider's key is saved, or its subscription signed in, whichever it is paid by. */
  async function usable(provider: AgentProvider) {
    return agentAuth(config, provider) === AgentAuth.Subscription
      ? credentials.signedIn(provider)
      : (await secrets.state(AGENT_PROVIDER_SECRET[provider])) ===
          SecretState.Saved;
  }

  return {
    models: catalog.models,

    async settings(): Promise<AgentSettings> {
      const { provider, model, thinking } = config.read().agent;
      const found = catalog.model(provider, model);

      return {
        providers: await Promise.all(
          Object.values(AgentProvider).map(async (each) => ({
            provider: each,
            enabled: enabled(each),
            auth: agentAuth(config, each),
            subscription: hasSubscription(each)
              ? { signedIn: await credentials.signedIn(each) }
              : null,
            usable: await usable(each),
          }))
        ),
        provider,
        model: found?.id ?? DEFAULT_MODEL[provider],
        thinking,
        models: Object.values(AgentProvider)
          .filter(enabled)
          .flatMap((each) => catalog.options(each)),
        ready: found !== undefined && (await usable(provider)),
      };
    },

    /** The conversation's own model, or the default one where `pick` names none. */
    async choice(
      pick: AgentModelPick = { model: null, thinking: null }
    ): Promise<AgentModelChoice> {
      const defaults = config.read().agent;

      const { provider, id } = pick.model ?? {
        provider: defaults.provider,
        id: defaults.model,
      };

      if (!enabled(provider)) {
        throw new Error(
          `${provider} is switched off in Settings; switch it on or pick another model`
        );
      }

      const model = catalog.model(provider, id);

      if (!model) {
        throw new Error(`Pick a model for ${provider} in Settings first`);
      }

      if (!(await usable(provider))) {
        throw new Error(
          agentAuth(config, provider) === AgentAuth.Subscription
            ? `Sign in to ${provider} in Settings first`
            : `Save an API key for ${provider} in Settings first`
        );
      }

      return { model, thinking: pick.thinking ?? defaults.thinking };
    },

    /** Resolves once the sign-in is saved, or quietly once it is cancelled; the page is written in `locale`. */
    signIn: (provider: AgentProvider, locale: Locale) =>
      catalog.signIn(provider, (outcome, detail) =>
        signInPage(locale, SignInFlow.ChatGPT, outcome, detail)
      ),

    cancelSignIn: () => catalog.cancelSignIn(),

    signOut: (provider: AgentProvider) => catalog.signOut(provider),
  };
}
