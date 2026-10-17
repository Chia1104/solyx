import { createModels } from "@earendil-works/pi-ai";
import type {
  AnyModel,
  Api,
  AuthContext,
  AuthPrompt,
  Credential,
  CredentialStore,
  Model,
  ModelsStore,
  ModelsStoreEntry,
  OAuthAuth,
  Provider,
} from "@earendil-works/pi-ai";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { isPlainObject } from "es-toolkit";
import * as z from "zod";

import { readJsonSync, writeFileAtomicSync } from "@solyx/utils/server";

import { chatgptOAuth } from "./chatgpt-oauth.ts";
import { OLLAMA, OLLAMA_ENDPOINT, createOllamaProvider } from "./ollama.ts";
import { createOpenRouterKey } from "./openrouter-key.ts";
import type { AgentProvider } from "./providers.ts";
import type { SignInPage } from "./sign-in-callback.ts";
import { createSignInSlot } from "./sign-in.ts";

// Keys come only from what the user saved in the app, never from the environment or files.
const NO_AMBIENT_AUTH: AuthContext = {
  env: async () => undefined,
  fileExists: async () => false,
};

// pi-ai's built-in providers the app does not offer: each runs on something other than one key or
// a sign-in the app keeps.
const WITHHELD = new Set([
  // pi-ai's older route to a ChatGPT subscription; the app signs in to OpenAI itself.
  "openai-codex",
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

/** The subscription a sign-in runs a provider on. */
export interface Subscription {
  /** The plan as the provider names it, a brand name shown as it is. */
  plan: string;
  /** The provider runs on nothing else, so it takes no key. */
  only: boolean;
}

/** What a flow the app runs itself is given, whichever provider it signs in to. */
interface OwnFlowOptions {
  appName: string;
  callbackPage: SignInPage;
}

/** A sign-in that runs the provider on the user's subscription. */
interface SubscriptionSignIn extends Subscription {
  /** The app's own flow, where it stands in for pi-ai's. */
  flow?: (options: OwnFlowOptions) => OAuthAuth;
  /** What pi-ai's flow is answered where it asks the user something, by the kind of question. */
  answers?: Partial<Record<AuthPrompt["type"], string>>;
}

/** A sign-in that ends in a key the user owns, which the host saves as the provider's API key. */
interface KeySignIn {
  createKey: (
    options: OwnFlowOptions & {
      openExternal: (url: string) => void;
      signal: AbortSignal;
    }
  ) => Promise<string>;
}

// How each provider that signs in does so; one missing here runs on its key alone. A subscription
// signs in through pi-ai's own flow unless the app has one, and pi-ai's is kept only where it runs
// on a code the user enters on the provider's page and reads nothing from the environment.
const SIGN_INS = new Map<AgentProvider, SubscriptionSignIn | KeySignIn>([
  [
    "github-copilot",
    {
      plan: "GitHub Copilot",
      only: true,
      // GitHub asks which GitHub to sign in to: blank is github.com, the only one offered.
      answers: { text: "" },
    },
  ],
  ["meta", { plan: "Muse", only: false }],
  ["openai", { plan: "ChatGPT", only: false, flow: chatgptOAuth }],
  ["openrouter", { createKey: createOpenRouterKey }],
  ["xai", { plan: "SuperGrok / X Premium", only: false }],
]);

function subscriptionSignIn(provider: AgentProvider) {
  const signIn = SIGN_INS.get(provider);

  return signIn && "plan" in signIn ? signIn : undefined;
}

function keySignIn(provider: AgentProvider) {
  const signIn = SIGN_INS.get(provider);

  return signIn && "createKey" in signIn ? signIn : undefined;
}

/** The subscription a sign-in runs the provider on; `undefined` for a provider that runs on a key alone. */
export function subscriptionOf(
  provider: AgentProvider
): Subscription | undefined {
  const signIn = subscriptionSignIn(provider);

  return signIn && { plan: signIn.plan, only: signIn.only };
}

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
  "github-copilot": "claude-fable-5.1",
  google: "gemini-4-argon",
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

/** A provider the app may offer: it has chat models and pi-ai sets it up with a key alone. */
function isOffered(provider: Provider): boolean {
  return (
    !WITHHELD.has(provider.id) &&
    provider.auth.apiKey?.login !== undefined &&
    provider.getModels().length > 0
  );
}

const storedSchema = z.record(
  z.string(),
  z.object({
    // SAFETY: only this store writes the file, each model as pi-ai handed it over.
    models: z.array(z.custom<AnyModel>(isPlainObject)),
    lastModified: z.number().optional(),
    checkedAt: z.number().optional(),
    etag: z.string().optional(),
  })
);

/**
 * The models each server the user runs listed last, kept in `file` so a conversation finds its
 * model as the app starts, before the server is asked again or while it is not running.
 */
export function fileModelsStore(file: string): ModelsStore {
  const entries = () => readJsonSync(file, storedSchema) ?? {};

  return {
    read: async (provider) => entries()[provider],

    async write(provider, entry: ModelsStoreEntry) {
      writeFileAtomicSync(
        file,
        JSON.stringify({ ...entries(), [provider]: entry })
      );
    },

    async delete(provider) {
      const { [provider]: _gone, ...rest } = entries();

      writeFileAtomicSync(file, JSON.stringify(rest));
    },
  };
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
  /** Where the models a server the user runs listed last are kept. */
  modelsStore: ModelsStore;
  /** @default globalThis.fetch */
  fetch?: typeof globalThis.fetch;
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
  modelsStore,
  fetch,
}: ModelCatalogOptions) {
  // pi-ai loads a sign-in flow by its file, which a bundle such as the app's main process does not
  // hold, so its flows are registered up front, all of them, as pi-ai offers no fewer. Only those
  // of the providers kept below can run.
  registerBunOAuthFlows();

  const slot = createSignInSlot();

  // The open sign-in's page; a sign-in is only ever open through `signIn`.
  let landing: SignInPage = () => "";

  const ollamaEndpoint = () => endpoint(OLLAMA) ?? OLLAMA_ENDPOINT;

  // A provider runs on its key, and one with a subscription also signs in, or only signs in,
  // through the app's own flow where it has one and pi-ai's otherwise. Every other sign-in of
  // pi-ai's is stripped. Ollama is the app's own, a server the user runs.
  const offered = builtinProviders()
    .filter(isOffered)
    .map((provider): Provider => {
      const signIn = subscriptionSignIn(provider.id);

      const oauth = signIn?.flow
        ? signIn.flow({
            appName,
            callbackPage: (outcome, detail) => landing(outcome, detail),
          })
        : signIn && provider.auth.oauth;

      if (!oauth)
        return { ...provider, auth: { apiKey: provider.auth.apiKey } };

      return {
        ...provider,
        auth: signIn?.only
          ? { oauth }
          : { apiKey: provider.auth.apiKey, oauth },
      };
    })
    .concat(createOllamaProvider({ endpoint: ollamaEndpoint, fetch }))
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
    modelsStore,
  });

  // Ollama lists no models until its server is asked, but always serves them from one endpoint.
  const endpoints = new Map(
    offered.map((provider) => [
      provider.id,
      provider.id === OLLAMA ? OLLAMA_ENDPOINT : sharedEndpoint(provider),
    ])
  );

  // Ollama's models are kept as the server listed them, so its own endpoint is applied too:
  // otherwise going back to it would leave them on the host set before.
  for (const provider of offered) {
    models.setProvider(
      endpoints.get(provider.id) === undefined
        ? provider
        : withEndpoint(
            provider,
            provider.id === OLLAMA
              ? ollamaEndpoint
              : () => endpoint(provider.id)
          )
    );
  }

  // Why each server the user runs failed to list its models when last asked.
  const failures = new Map<AgentProvider, Error>();

  /**
   * The provider's chat models the user may run, in its catalog's order: all of them, but for a
   * provider whose sign-in lists the ones the account has, as GitHub Copilot's does.
   */
  async function available(
    provider: AgentProvider
  ): Promise<readonly Model<Api>[]> {
    const listed = models.getModels(provider);
    const filter = models.getProvider(provider)?.filterModels;

    return filter ? filter(listed, await credentials.read(provider)) : listed;
  }

  /** The model new conversations on the provider start on, of those `available` gave. */
  function defaultOf(provider: AgentProvider, listed: readonly Model<Api>[]) {
    const preferred = DEFAULT_MODEL[provider];

    return listed.find((model) => model.id === preferred) ?? listed[0];
  }

  return {
    models,

    /** The providers the user can switch on, by name. */
    providers: (): AgentProviderInfo[] =>
      offered.map(({ id, name }) => ({ id, name })),

    offers: (provider: AgentProvider) => ids.has(provider),

    /**
     * Whether the provider is a server the user runs: it lists the models it holds, and takes a
     * key only where a proxy in front of it checks one.
     */
    servedByUser: (provider: AgentProvider) => provider === OLLAMA,

    /** Restores the models each server the user runs listed last, without asking it, as the app starts. */
    async restore() {
      await models.refresh({ allowNetwork: false });
    },

    /** Has each of `providers` that is a server the user runs list its models again; one that fails keeps its last list. */
    async refresh(providers: readonly AgentProvider[]) {
      const servers = providers.filter((provider) => provider === OLLAMA);

      const { errors } = await models.refresh({
        providers: servers,
        force: true,
      });

      for (const server of servers) {
        const error = errors.get(server);

        if (error) failures.set(server, error);
        else failures.delete(server);
      }
    },

    /** Why the server failed to list its models when last asked; `null` once it answered. */
    listingFailure: (provider: AgentProvider) =>
      failures.get(provider)?.message ?? null,

    /** The provider's own endpoint, which `endpoint` may replace; `undefined` when its models use several. */
    defaultEndpoint: (provider: AgentProvider) => endpoints.get(provider),

    /** The id of the model new conversations on the provider start on. */
    defaultModel: async (provider: AgentProvider) =>
      defaultOf(provider, await available(provider))?.id,

    /** The provider's model `id`, or its default one when the user may run no such model. */
    async model(
      provider: AgentProvider,
      id: string | undefined
    ): Promise<Model<Api> | undefined> {
      const listed = await available(provider);

      return (
        listed.find((model) => model.id === id) ?? defaultOf(provider, listed)
      );
    },

    /** The provider's chat models the user may run, in its catalog's order. */
    async options(provider: AgentProvider): Promise<AgentModelOption[]> {
      const listed = await available(provider);

      return listed.map(({ id, name, reasoning, contextWindow }) => ({
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
      const signIn = subscriptionSignIn(provider);

      if (!signIn) throw new Error(`${provider} has no subscription sign-in`);

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
            // The browser, or the code entered in it, brings the sign-in back, so the user is
            // asked nothing here: a question the provider's sign-in has no answer for ends it.
            async prompt(request) {
              const answer = signIn.answers?.[request.type];

              if (answer === undefined) {
                throw new Error(`Unsupported sign-in step: ${request.type}`);
              }

              return answer;
            },
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
    createsKey: (provider: AgentProvider) => keySignIn(provider) !== undefined,

    /**
     * Signs in to the provider in the browser, where the user has it create a key for the app.
     * Resolves with the key, or with `undefined` once the sign-in is cancelled. A sign-in still
     * open gives way to the new one.
     */
    async createKey(
      provider: AgentProvider,
      page: SignInPage
    ): Promise<string | undefined> {
      const signIn = keySignIn(provider);

      if (!signIn) throw new Error(`${provider} creates no key by sign-in`);

      let key: string | undefined;

      await slot.run(async (signal) => {
        key = await signIn.createKey({
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
