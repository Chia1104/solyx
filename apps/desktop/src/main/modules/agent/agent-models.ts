import { uniq } from "es-toolkit";

import { createModelCatalog } from "@solyx/agent/models";
import {
  AgentAuth,
  DEFAULT_PROVIDER,
  hasSubscription,
} from "@solyx/agent/providers";
import type { AgentModelPick, AgentProvider } from "@solyx/agent/providers";
import type { AgentModelChoice } from "@solyx/agent/runtime";

import { SecretState, agentKeySecret } from "#shared/ipc/settings.ts";
import type { AgentSettings, Locale } from "#shared/ipc/settings.ts";

import { PRODUCT_NAME } from "../../product.ts";
import type { ConfigFile } from "../settings/config-file.ts";
import { createCredentialStore } from "../settings/credential-store.ts";
import type { SecretStore } from "../settings/secret-store.ts";
import { SignInFlow, signInPage } from "../settings/sign-in-page.ts";

type AgentConfig = ReturnType<ConfigFile["read"]>["agent"];

/** How `agent` says `provider` is paid for; a provider without a subscription runs on a key. */
function authOf(agent: AgentConfig, provider: AgentProvider): AgentAuth {
  return hasSubscription(provider) ? agent.auth : AgentAuth.ApiKey;
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
  const agentConfig = () => config.read().agent;

  // pi-ai reads the sign-in or the key here for each request, as the config file says to pay.
  const credentials = createCredentialStore(
    secrets,
    (provider) => authOf(agentConfig(), provider) === AgentAuth.Subscription
  );

  const catalog = createModelCatalog({
    credentials,
    // OpenAI shows it on the consent screen; development builds sign in under the same name.
    appName: PRODUCT_NAME,
    getDeviceId,
    openExternal,
    // pi-ai tells a ChatGPT sign-in by OpenAI's own endpoint, so a subscription keeps it.
    endpoint(provider) {
      const agent = agentConfig();

      return authOf(agent, provider) === AgentAuth.ApiKey
        ? agent.endpoints[provider]
        : undefined;
    },
  });

  /** The model new conversations start on; a provider the app no longer offers reads as the default one. */
  function defaults(agent: AgentConfig) {
    return catalog.offers(agent.provider)
      ? agent
      : { ...agent, provider: DEFAULT_PROVIDER, model: undefined };
  }

  /** Switched on by the user, or the default model's, which cannot be switched off. */
  function enabled(agent: AgentConfig, provider: AgentProvider) {
    return (
      catalog.offers(provider) &&
      (provider === defaults(agent).provider ||
        agent.providers.includes(provider))
    );
  }

  /** What is saved for the provider, and whether that runs it as it is paid for. */
  async function setUp(agent: AgentConfig, provider: AgentProvider) {
    const auth = authOf(agent, provider);
    const key = await secrets.state(agentKeySecret(provider));

    const signedIn = hasSubscription(provider)
      ? await credentials.signedIn(provider)
      : undefined;

    return {
      auth,
      key,
      signedIn,
      usable:
        auth === AgentAuth.Subscription
          ? signedIn === true
          : key === SecretState.Saved,
    };
  }

  /** The provider's endpoint as set, beside its own; `null` for a provider whose models use several. */
  function endpoint(agent: AgentConfig, provider: AgentProvider) {
    const own = catalog.defaultEndpoint(provider);

    return own === undefined
      ? null
      : { url: agent.endpoints[provider] ?? own, default: own };
  }

  /** Refuses a provider the app does not offer, before anything is saved for it. */
  function offered(provider: AgentProvider) {
    if (!catalog.offers(provider)) {
      throw new Error(`${provider} is not a provider the app offers`);
    }
  }

  return {
    models: catalog.models,

    async settings(): Promise<AgentSettings> {
      const agent = agentConfig();
      const { provider, model, thinking } = defaults(agent);
      const found = catalog.model(provider, model);

      const providers = await Promise.all(
        catalog.providers().map(async ({ id, name }) => {
          const { auth, key, signedIn, usable } = await setUp(agent, id);
          const on = enabled(agent, id);

          return {
            provider: id,
            name,
            enabled: on,
            listed: on || key !== SecretState.Missing || signedIn === true,
            auth,
            subscription: signedIn === undefined ? null : { signedIn },
            key,
            usable,
            endpoint: endpoint(agent, id),
          };
        })
      );

      return {
        providers,
        provider,
        model: found?.id ?? "",
        thinking,
        decisionMode: agent.decisionMode,
        models: providers
          .filter((each) => each.enabled)
          .flatMap((each) => catalog.options(each.provider)),
        ready:
          found !== undefined &&
          providers.some((each) => each.provider === provider && each.usable),
      };
    },

    async setProviderEnabled(provider: AgentProvider, on: boolean) {
      offered(provider);

      const current = agentConfig().providers;

      config.set(
        ["agent", "providers"],
        on
          ? uniq([...current, provider])
          : current.filter((each) => each !== provider)
      );
    },

    /** A model id means nothing to another provider, so switching starts from its default. */
    async setDefaultProvider(provider: AgentProvider) {
      offered(provider);

      config.update([
        [["agent", "provider"], provider],
        [["agent", "model"], catalog.defaultModel(provider)],
      ]);
    },

    async saveKey(provider: AgentProvider, value: string) {
      offered(provider);
      await secrets.save(agentKeySecret(provider), value);
    },

    async deleteKey(provider: AgentProvider) {
      offered(provider);
      await secrets.delete(agentKeySecret(provider));
    },

    /** Sends the provider's requests on an API key to `to`; `null` goes back to its own endpoint. */
    async setEndpoint(provider: AgentProvider, to: string | null) {
      offered(provider);

      if (catalog.defaultEndpoint(provider) === undefined) {
        throw new Error(
          `${provider}'s models use several endpoints, so none can stand in for them`
        );
      }

      // Removing the entry reads as the provider's own endpoint.
      config.set(["agent", "endpoints", provider], to ?? undefined);
    },

    /** The conversation's own model, or the default one where `pick` names none. */
    async choice(
      pick: AgentModelPick = { model: null, thinking: null }
    ): Promise<AgentModelChoice> {
      const agent = agentConfig();
      const start = defaults(agent);

      const { provider, id } = pick.model ?? {
        provider: start.provider,
        id: start.model,
      };

      if (!catalog.offers(provider)) {
        throw new Error(
          `${provider} is no longer offered; pick another model for this conversation`
        );
      }

      if (!enabled(agent, provider)) {
        throw new Error(
          `${provider} is switched off in Settings; switch it on or pick another model`
        );
      }

      const model = catalog.model(provider, id);

      if (!model) {
        throw new Error(`Pick a model for ${provider} in Settings first`);
      }

      const { auth, usable } = await setUp(agent, provider);

      if (!usable) {
        throw new Error(
          auth === AgentAuth.Subscription
            ? `Sign in to ${provider} in Settings first`
            : `Save an API key for ${provider} in Settings first`
        );
      }

      return { model, thinking: pick.thinking ?? start.thinking };
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
