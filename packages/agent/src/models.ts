import { createModels } from "@earendil-works/pi-ai";
import type {
  Api,
  AuthContext,
  Credential,
  CredentialStore,
  Model,
  Provider,
} from "@earendil-works/pi-ai";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

import { chatgptOAuth } from "./chatgpt-oauth.ts";
import { createOpenRouterKey } from "./openrouter-key.ts";
import type { AgentProvider } from "./providers.ts";
import type { SignInPage } from "./sign-in-callback.ts";
import { createSignInSlot } from "./sign-in.ts";

// Keys come only from what the user saved in the app, never from the environment or files.
const NO_AMBIENT_AUTH: AuthContext = {
  env: async () => undefined,
  fileExists: async () => false,
};

// pi-ai's built-in providers the app does not offer: each runs on something other than one key.
const WITHHELD = new Set([
  // pi-ai's older route to a ChatGPT subscription; the app signs in to OpenAI itself.
  "openai-codex",
  // Runs only on a Copilot sign-in.
  "github-copilot",
  // Pi's own gateway, which signs in through pi.
  "radius",
  // Lists only classifiers, which the decisions model reaches on its own.
  "typesafe",
  // Read cloud credentials from this computer.
  "amazon-bedrock",
  "google-vertex",
  // Need an account, gateway or resource beside the key.
  "azure",
  "cloudflare-ai-gateway",
  "cloudflare-workers-ai",
]);

// The provider whose sign-in ends in a key the user owns, which the host saves as its API key.
const KEY_SIGN_IN: AgentProvider = "openrouter";

// The provider that signs in through the app's own Sign in with ChatGPT flow.
const CHATGPT_PROVIDER: AgentProvider = "openai";

// The plan a sign-in runs a provider on, by the provider's own name for it. OpenAI signs in through
// the app's own flow and the others through pi-ai's, which is kept only where it runs on a code the
// user enters on the provider's page and reads nothing from the environment.
const SUBSCRIPTIONS = new Map<AgentProvider, string>([
  [CHATGPT_PROVIDER, "ChatGPT"],
  ["meta", "Muse"],
  ["xai", "SuperGrok / X Premium"],
]);

/** The plan a sign-in runs the provider on, as the provider names it; `undefined` for a provider that runs on a key alone. */
export const subscriptionOf = (provider: AgentProvider) =>
  SUBSCRIPTIONS.get(provider);

/**
 * A provider's most capable model, used until the user picks one. A provider missing here, or
 * whose catalog no longer lists the model, starts on the first model its catalog lists.
 */
export const DEFAULT_MODEL: Partial<Record<AgentProvider, string>> = {
  anthropic: "claude-fable-5-1",
  "ant-ling": "Ring-2.6-1T",
  baseten: "zai-org/GLM-5.2",
  cerebras: "gpt-oss-120b",
  deepseek: "deepseek-v4-pro",
  fireworks: "accounts/fireworks/models/kimi-k3",
  google: "gemini-3.1-pro-preview",
  groq: "openai/gpt-oss-120b",
  huggingface: "moonshotai/Kimi-K2.6",
  "kimi-coding": "kimi-for-coding",
  meta: "muse-spark-1.3",
  minimax: "MiniMax-M2.7",
  "minimax-cn": "MiniMax-M2.7",
  mistral: "mistral-large-latest",
  moonshotai: "kimi-k2.6",
  "moonshotai-cn": "kimi-k2.6",
  nvidia: "nvidia/nemotron-3-ultra-550b-a55b",
  openai: "gpt-6.1-sol",
  opencode: "kimi-k2.6",
  "opencode-go": "kimi-k3",
  openrouter: "anthropic/claude-fable-5.1",
  "qwen-token-plan": "qwen3.7-max",
  "qwen-token-plan-cn": "qwen3.7-max",
  "qwen-token-plan-individual": "qwen3.8-max",
  together: "moonshotai/Kimi-K3",
  "vercel-ai-gateway": "anthropic/claude-fable-5.1",
  xai: "grok-4.7",
  xiaomi: "mimo-v2.5-pro",
  "xiaomi-token-plan-ams": "mimo-v2.5-pro",
  "xiaomi-token-plan-cn": "mimo-v2.5-pro",
  "xiaomi-token-plan-sgp": "mimo-v2.5-pro",
  zai: "glm-5.3",
  "zai-coding-cn": "glm-5.3",
};

/** A provider the app offers: it has chat models and the user sets it up by entering a key. */
function isOffered(provider: Provider): boolean {
  return (
    !WITHHELD.has(provider.id) &&
    provider.auth.apiKey?.login !== undefined &&
    provider.getModels().length > 0
  );
}

/** What the host saved for each provider; the catalog asks only about the providers it offers. */
export interface ProviderCredentials {
  /** The provider's API key, or its sign-in while the user runs on a subscription. */
  read(provider: AgentProvider): Promise<Credential | undefined>;
  /** Which of the two is saved for the provider, without reading it. */
  stored(provider: AgentProvider): Promise<Credential["type"] | undefined>;
  modify: CredentialStore["modify"];
  delete: CredentialStore["delete"];
}

export interface ModelCatalogOptions {
  /** pi-ai reads every request's credential here, through the catalog. */
  credentials: ProviderCredentials;
  /** Shown on OpenAI's consent screen and on the key OpenRouter creates, the same on every installation. */
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

/** The code a sign-in waits for the user to enter on the provider's page. */
export interface SignInCode {
  code: string;
  /** The provider's page, which the catalog opens in the browser. */
  url: string;
}

export interface SignInOptions {
  /** The page the browser lands on where the sign-in returns to this computer. */
  page: SignInPage;
  /** Shows the user the code of a sign-in that runs on one. */
  onCode: (code: SignInCode) => void;
}

/** A provider the user can switch on, by pi-ai's id and name for it. */
export interface AgentProviderInfo {
  id: AgentProvider;
  name: string;
}

/** A model the user can pick. */
export interface AgentModelOption {
  provider: AgentProvider;
  id: string;
  name: string;
  reasoning: boolean;
  /** Tokens a request may hold, prompt and answer together. */
  contextWindow: number;
}

/**
 * The providers' model catalogs and their sign-ins. A request on an API key carries it explicitly;
 * one on a subscription resolves and refreshes its sign-in through `credentials`. OpenAI signs in
 * through the app's own Sign in with ChatGPT flow in place of pi-ai's, and OpenRouter through the
 * app's own run of its flow, which ends in a key.
 */
export function createModelCatalog({
  credentials,
  appName,
  getDeviceId,
  openExternal,
  endpoint,
}: ModelCatalogOptions) {
  // pi-ai loads a sign-in flow by its file, which a bundle such as the app's main process does not
  // hold, so its flows are registered up front, all of them, as pi-ai offers no fewer. Only those
  // of the providers kept below can run.
  registerBunOAuthFlows();

  const slot = createSignInSlot();

  // The open sign-in's page; a sign-in is only ever open through `signIn`.
  let landing: SignInPage = () => "";

  const chatgpt = chatgptOAuth({
    appName,
    callbackPage: (outcome, detail) => landing(outcome, detail),
  });

  // Every provider runs on its key, and one with a subscription also signs in: OpenAI through the
  // app's own flow, the others through pi-ai's. No other sign-in flow of pi-ai's is ever loaded.
  const signInOf = (provider: Provider) =>
    provider.id === CHATGPT_PROVIDER
      ? chatgpt
      : SUBSCRIPTIONS.has(provider.id)
        ? provider.auth.oauth
        : undefined;

  const offered = builtinProviders()
    .filter(isOffered)
    .map((provider): Provider => {
      const oauth = signInOf(provider);

      return {
        ...provider,
        auth: oauth
          ? { apiKey: provider.auth.apiKey, oauth }
          : { apiKey: provider.auth.apiKey },
      };
    })
    .toSorted((a, b) => a.name.localeCompare(b.name));

  const ids = new Set(offered.map((provider) => provider.id));

  // pi-ai asks only about the providers set below, so the host is never asked about another id.
  const models = createModels({
    credentials: {
      read: (id) => credentials.read(id),

      async list() {
        const listed = await Promise.all(
          offered.map(async ({ id }) => {
            const type = await credentials.stored(id);

            return type === undefined ? [] : [{ providerId: id, type }];
          })
        );

        return listed.flat();
      },

      modify: (id, change) => credentials.modify(id, change),
      delete: (id) => credentials.delete(id),
    },
    authContext: NO_AMBIENT_AUTH,
  });

  const endpoints = new Map(
    offered.map((provider) => [provider.id, sharedEndpoint(provider)])
  );

  for (const provider of offered) {
    models.setProvider(
      endpoints.get(provider.id) === undefined
        ? provider
        : withEndpoint(provider, () => endpoint(provider.id))
    );
  }

  /** The model new conversations on the provider start on. */
  function defaultModel(provider: AgentProvider): Model<Api> | undefined {
    const preferred = DEFAULT_MODEL[provider];

    return (
      (preferred === undefined
        ? undefined
        : models.getModel(provider, preferred)) ?? models.getModels(provider)[0]
    );
  }

  return {
    models,

    /** The providers the user can switch on, by name. */
    providers: (): AgentProviderInfo[] =>
      offered.map(({ id, name }) => ({ id, name })),

    offers: (provider: AgentProvider) => ids.has(provider),

    /** The provider's own endpoint, which `endpoint` may replace; `undefined` when its models use several. */
    defaultEndpoint: (provider: AgentProvider) => endpoints.get(provider),

    /** The id of the model new conversations on the provider start on. */
    defaultModel: (provider: AgentProvider) => defaultModel(provider)?.id,

    /** The provider's model `id`, or its default one when the catalog lists no such model. */
    model(
      provider: AgentProvider,
      id: string | undefined
    ): Model<Api> | undefined {
      return (
        (id === undefined ? undefined : models.getModel(provider, id)) ??
        defaultModel(provider)
      );
    },

    /** The provider's chat models, in its catalog's order. */
    options(provider: AgentProvider): AgentModelOption[] {
      return models
        .getModels(provider)
        .map(({ id, name, reasoning, contextWindow }) => ({
          provider,
          id,
          name,
          reasoning,
          contextWindow,
        }));
    },

    /**
     * Signs in to the provider's subscription in the browser, resolving once the sign-in is saved
     * or quietly once it is cancelled. A sign-in still open gives way to the new one.
     */
    async signIn(provider: AgentProvider, { page, onCode }: SignInOptions) {
      if (!SUBSCRIPTIONS.has(provider)) {
        throw new Error(`${provider} has no subscription sign-in`);
      }

      // A provider's own page is https; nothing else a flow names is opened.
      const open = (url: string) => {
        if (url.startsWith("https://")) openExternal(url);
      };

      await slot.run(async (signal) => {
        landing = page;

        await models.login(
          provider,
          "oauth",
          {
            signal,
            // No flow kept asks the user anything here; the browser, or the code entered in it,
            // brings the sign-in back.
            prompt: (request) =>
              Promise.reject(
                new Error(`Unsupported sign-in step: ${request.type}`)
              ),
            notify: (event) => {
              if (event.type === "auth_url") open(event.url);

              if (event.type === "device_code") {
                onCode({ code: event.userCode, url: event.verificationUri });
                open(event.verificationUri);
              }
            },
          },
          { getDeviceId }
        );
      });
    },

    /** Whether a sign-in to the provider creates the key it runs on, in place of one pasted in. */
    createsKey: (provider: AgentProvider) => provider === KEY_SIGN_IN,

    /**
     * Signs in to the provider in the browser, where the user has it create a key for the app.
     * Resolves with the key, or with `undefined` once the sign-in is cancelled. A sign-in still
     * open gives way to the new one.
     */
    async createKey(
      provider: AgentProvider,
      page: SignInPage
    ): Promise<string | undefined> {
      if (provider !== KEY_SIGN_IN) {
        throw new Error(`${provider} creates no key by sign-in`);
      }

      let key: string | undefined;

      await slot.run(async (signal) => {
        key = await createOpenRouterKey({
          appName,
          callbackPage: page,
          openExternal,
          signal,
        });
      });

      return key;
    },

    cancelSignIn() {
      slot.cancel();
    },

    signOut: (provider: AgentProvider) => models.logout(provider),
  };
}

export type ModelCatalog = ReturnType<typeof createModelCatalog>;
