import { createModels } from "@earendil-works/pi-ai";
import type {
  Api,
  AuthContext,
  CredentialStore,
  Model,
  Provider,
} from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { mapValues } from "es-toolkit";

import { chatgptOAuth } from "./chatgpt-oauth.ts";
import type { SignInOutcome } from "./chatgpt-oauth.ts";
import { AgentProvider, DEFAULT_MODEL, hasSubscription } from "./providers.ts";
import { createSignInSlot } from "./sign-in.ts";

// Keys come only from what the user saved in the app, never from the environment or files.
const NO_AMBIENT_AUTH: AuthContext = {
  env: async () => undefined,
  fileExists: async () => false,
};

export interface ModelCatalogOptions {
  /** pi-ai reads every request's credential here: the API key, or the sign-in while the user runs on a subscription. */
  credentials: CredentialStore;
  /** Shown on OpenAI's consent screen, the same on every installation. */
  appName: string;
  /** This installation's stable id, which Sign in with ChatGPT requires. */
  getDeviceId: () => string;
  /** Opens a sign-in page in the system browser. */
  openExternal: (url: string) => void;
  /**
   * Where the provider's requests go in place of its own endpoint, read for every request;
   * `undefined` keeps its own. Applies only to a provider whose models share one endpoint.
   */
  endpoint: (provider: AgentProvider) => string | undefined;
}

/** The one endpoint every model of the provider is served from, or `undefined` when they use several. */
function sharedEndpoint(provider: Provider): string | undefined {
  const endpoints = new Set(
    (provider.getAllModels?.() ?? provider.getModels()).map(
      (model) => model.baseUrl
    )
  );

  return endpoints.size === 1 ? [...endpoints][0] : undefined;
}

/** The provider with its models served from `endpoint()` while that names one. */
function withEndpoint(
  provider: Provider,
  endpoint: () => string | undefined
): Provider {
  const { getAllModels } = provider;

  const served = <T extends { baseUrl: string }>(model: T): T => {
    const baseUrl = endpoint();

    return baseUrl === undefined ? model : { ...model, baseUrl };
  };

  return {
    ...provider,
    getModels: () => provider.getModels().map(served),
    getAllModels: getAllModels && (() => getAllModels().map(served)),
  };
}

/** A model the user can pick. */
export interface AgentModelOption {
  provider: AgentProvider;
  id: string;
  name: string;
  reasoning: boolean;
}

/** The page the browser lands on when a sign-in returns, written for whoever started it. */
export type SignInPage = (outcome: SignInOutcome, detail?: string) => string;

/**
 * The providers' model catalogs and their subscription sign-ins. A request on an API key carries
 * it explicitly; one on a subscription resolves and refreshes its sign-in through `credentials`.
 * OpenAI signs in through the app's own Sign in with ChatGPT flow in place of pi-ai's.
 */
export function createModelCatalog({
  credentials,
  appName,
  getDeviceId,
  openExternal,
  endpoint,
}: ModelCatalogOptions) {
  const slot = createSignInSlot();

  // The open sign-in's page; a sign-in is only ever open through `signIn`.
  let landing: SignInPage = () => "";

  const models = createModels({ credentials, authContext: NO_AMBIENT_AUTH });
  const openai = openaiProvider();

  const chatgpt = chatgptOAuth({
    appName,
    callbackPage: (outcome, detail) => landing(outcome, detail),
  });

  const providers: Record<AgentProvider, Provider> = {
    [AgentProvider.Anthropic]: anthropicProvider(),
    [AgentProvider.OpenAI]: {
      ...openai,
      auth: { ...openai.auth, oauth: chatgpt },
    },
    [AgentProvider.Google]: googleProvider(),
    [AgentProvider.OpenRouter]: openrouterProvider(),
  };

  const endpoints = mapValues(providers, sharedEndpoint);

  for (const each of Object.values(AgentProvider)) {
    models.setProvider(
      endpoints[each] === undefined
        ? providers[each]
        : withEndpoint(providers[each], () => endpoint(each))
    );
  }

  return {
    models,

    /** The provider's own endpoint, which `endpoint` may replace; `undefined` when its models use several. */
    defaultEndpoint: (provider: AgentProvider) => endpoints[provider],

    /** The provider's model `id`, or its default one when the catalog lists no such model. */
    model(
      provider: AgentProvider,
      id: string | undefined
    ): Model<Api> | undefined {
      return (
        (id === undefined ? undefined : models.getModel(provider, id)) ??
        models.getModel(provider, DEFAULT_MODEL[provider])
      );
    },

    /** The provider's chat models, in its catalog's order. */
    options(provider: AgentProvider): AgentModelOption[] {
      return models
        .getModels(provider)
        .map(({ id, name, reasoning }) => ({ provider, id, name, reasoning }));
    },

    /**
     * Signs in to the provider's subscription in the browser, resolving once the sign-in is saved
     * or quietly once it is cancelled. A sign-in still open gives way to the new one.
     */
    async signIn(provider: AgentProvider, page: SignInPage) {
      if (!hasSubscription(provider)) {
        throw new Error(`${provider} has no subscription sign-in`);
      }

      await slot.run(async (signal) => {
        landing = page;

        await models.login(
          provider,
          "oauth",
          {
            signal,
            // The flow never asks the user anything; the browser brings the sign-in back.
            prompt: (request) =>
              Promise.reject(
                new Error(`Unsupported sign-in step: ${request.type}`)
              ),
            notify: (event) => {
              if (
                event.type === "auth_url" &&
                event.url.startsWith("https://")
              ) {
                openExternal(event.url);
              }
            },
          },
          { getDeviceId }
        );
      });
    },

    cancelSignIn() {
      slot.cancel();
    },

    signOut: (provider: AgentProvider) => models.logout(provider),
  };
}

export type ModelCatalog = ReturnType<typeof createModelCatalog>;
