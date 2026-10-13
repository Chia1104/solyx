import { uniq } from "es-toolkit";

import { createModelCatalog, subscriptionOf } from "@solyx/agent/models";
import { AgentAuth, DEFAULT_PROVIDER } from "@solyx/agent/providers";
import type { AgentModelPick, AgentProvider } from "@solyx/agent/providers";
import type { AgentModelChoice } from "@solyx/agent/runtime";

import { SecretState, agentKeySecret } from "#shared/ipc/settings.ts";
import type {
  AgentSettings,
  Locale,
  SignInCode,
} from "#shared/ipc/settings.ts";

import { PRODUCT_NAME } from "../../product.ts";
import type { ConfigFile } from "../settings/config-file.ts";
import { createCredentialStore } from "../settings/credential-store.ts";
import type { SecretStore } from "../settings/secret-store.ts";
import { SignInFlow, signInPage } from "../settings/sign-in-page.ts";

type AgentConfig = ReturnType<ConfigFile["read"]>["agent"];

/**
 * How `agent` says `provider` is paid for. A provider without a subscription runs on a key, and
 * one that takes no key on its subscription, whatever `agent` says.
 */
function authOf(agent: AgentConfig, provider: AgentProvider): AgentAuth {
  const subscription = subscriptionOf(provider);

  if (subscription === undefined) return AgentAuth.ApiKey;

  if (subscription.only) return AgentAuth.Subscription;

  return agent.auth[provider] ?? AgentAuth.ApiKey;
}

export interface AgentModelsOptions {
  config: ConfigFile;
  secrets: SecretStore;
  /** This installation's stable id, which Sign in with ChatGPT requires. */
  getDeviceId: () => string;
  /** Opens a sign-in page in the system browser. */
  openExternal: (url: string) => void;
  /** Shows the user the code a sign-in waits for them to enter on the provider's page. */
  showSignInCode: (code: SignInCode) => void;
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
  showSignInCode,
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
    // A sign-in's tokens go only to the provider's own endpoint, which is also how pi-ai tells a
    // ChatGPT sign-in.
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
    const offers = subscriptionOf(provider);

    const subscription =
      offers === undefined
        ? null
        : { ...offers, signedIn: await credentials.signedIn(provider) };

    return {
      auth,
      key,
      subscription,
      usable:
        auth === AgentAuth.Subscription
          ? subscription?.signedIn === true
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
      const found = await catalog.model(provider, model);

      const providers = await Promise.all(
        catalog.providers().map(async ({ id, name }) => {
          const { auth, key, subscription, usable } = await setUp(agent, id);
          const on = enabled(agent, id);

          return {
            provider: id,
            name,
            enabled: on,
            listed:
              on ||
              key !== SecretState.Missing ||
              subscription?.signedIn === true,
            auth,
            subscription,
            key,
            createsKey: catalog.createsKey(id),
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
        magi: agent.magi,
        models: (
          await Promise.all(
            providers
              .filter((each) => each.enabled)
              .map((each) => catalog.options(each.provider))
          )
        ).flat(),
        ready: providers.some((each) => each.enabled && each.usable),
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
        [["agent", "model"], await catalog.defaultModel(provider)],
      ]);
    },

    /** Runs the provider on its key, or on the sign-in of the subscription it has. */
    async setAuth(provider: AgentProvider, auth: AgentAuth) {
      offered(provider);

      if (
        authOf({ ...agentConfig(), auth: { [provider]: auth } }, provider) !==
        auth
      ) {
        throw new Error(
          auth === AgentAuth.Subscription
            ? `${provider} has no subscription sign-in`
            : `${provider} runs only on its subscription's sign-in`
        );
      }

      config.set(["agent", "auth", provider], auth);
    },

    async saveKey(provider: AgentProvider, value: string) {
      offered(provider);
      await secrets.save(agentKeySecret(provider), value);
    },

    async deleteKey(provider: AgentProvider) {
      offered(provider);
      await secrets.delete(agentKeySecret(provider));
    },

    /**
     * Saves the key the provider creates once the user signs in to it, or nothing once the
     * sign-in is cancelled; the page is written in `locale`.
     */
    async createKey(provider: AgentProvider, locale: Locale) {
      offered(provider);

      const key = await catalog.createKey(provider, (outcome, detail) =>
        signInPage(locale, SignInFlow.OpenRouter, outcome, detail)
      );

      if (key !== undefined) await secrets.save(agentKeySecret(provider), key);
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

      const model = await catalog.model(provider, id);

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

    /**
     * Resolves once the sign-in is saved, or quietly once it is cancelled. Only Sign in with
     * ChatGPT returns to this computer, on a page written in `locale`; the others run on a code.
     */
    signIn: (provider: AgentProvider, locale: Locale) =>
      catalog.signIn(provider, {
        page: (outcome, detail) =>
          signInPage(locale, SignInFlow.ChatGPT, outcome, detail),
        onCode: (code) => showSignInCode({ provider, ...code }),
      }),

    cancelSignIn: () => catalog.cancelSignIn(),

    signOut: (provider: AgentProvider) => catalog.signOut(provider),
  };
}

export type AgentModels = ReturnType<typeof createAgentModels>;
