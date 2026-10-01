import { chatgptOAuth } from "@solyx/agent/chatgpt-oauth";
import type { SignInOutcome } from "@solyx/agent/chatgpt-oauth";
import { createModelCatalog } from "@solyx/agent/models";
import {
  AgentAuth,
  AgentProvider,
  AgentThinking,
  DEFAULT_MODEL,
  SUBSCRIPTION_PROVIDERS,
  agentAuthSchema,
  agentProviderSchema,
  agentThinkingSchema,
} from "@solyx/agent/providers";
import type { AgentModelChoice } from "@solyx/agent/runtime";

import { AGENT_PROVIDER_SECRET, SecretState } from "#shared/ipc/settings.ts";
import type { AgentSettings } from "#shared/ipc/settings.ts";

import type { ConfigFile } from "../settings/config-file.ts";
import type { AgentCredentials } from "../settings/credential-store.ts";
import type { SecretStore } from "../settings/secret-store.ts";

// OpenAI shows it on the consent screen; development builds sign in under the same name.
const APP_NAME = "Solyx";

/** How the config file says `provider` is paid for; a provider without a subscription runs on a key. */
export function agentAuth(
  config: ConfigFile,
  provider: AgentProvider
): AgentAuth {
  const saved = config.read().agent;

  return SUBSCRIPTION_PROVIDERS.includes(provider)
    ? (agentAuthSchema.safeParse(saved?.auth).data ?? AgentAuth.ApiKey)
    : AgentAuth.ApiKey;
}

/**
 * The model the agent runs on and how it is paid for, as the config file, the saved keys and
 * subscription sign-ins pick them. An entry that no longer parses reads as its default, and a
 * model the provider does not list as the provider's.
 */
export function createAgentModels({
  config,
  secrets,
  credentials,
  getDeviceId,
  openExternal,
  signInPage,
}: {
  config: ConfigFile;
  secrets: SecretStore;
  credentials: AgentCredentials;
  /** This installation's stable id, which Sign in with ChatGPT requires. */
  getDeviceId: () => string;
  /** Opens a sign-in page in the system browser. */
  openExternal: (url: string) => void;
  /** The page the browser lands on once a sign-in returns, in the language it was started in. */
  signInPage: (
    locale: string,
    outcome: SignInOutcome,
    detail?: string
  ) => string;
}) {
  // The sign-in that is open, if any, and the language its page is written in.
  let signIn: { controller: AbortController; locale: string } | undefined;

  const catalog = createModelCatalog(
    credentials,
    chatgptOAuth({
      appName: APP_NAME,
      callbackPage: (outcome, detail) =>
        signInPage(signIn?.locale ?? "en-US", outcome, detail),
    })
  );

  function selection() {
    const saved = config.read().agent;

    const provider =
      agentProviderSchema.safeParse(saved?.provider).data ??
      AgentProvider.Anthropic;

    const model = catalog.getModel(
      provider,
      saved?.model ?? DEFAULT_MODEL[provider]
    );

    return {
      provider,
      subscribable: SUBSCRIPTION_PROVIDERS.includes(provider),
      auth: agentAuth(config, provider),
      model: model ?? catalog.getModel(provider, DEFAULT_MODEL[provider]),
      thinking:
        agentThinkingSchema.safeParse(saved?.thinking).data ??
        AgentThinking.Medium,
    };
  }

  return {
    catalog,

    async settings(): Promise<AgentSettings> {
      const { provider, subscribable, auth, model, thinking } = selection();
      const states = await secrets.states();

      const subscription = subscribable
        ? { signedIn: await credentials.signedIn(provider) }
        : null;

      return {
        provider,
        model: model?.id ?? DEFAULT_MODEL[provider],
        thinking,
        auth,
        subscription,
        models: catalog.getModels(provider).map((option) => ({
          id: option.id,
          name: option.name,
          reasoning: option.reasoning,
        })),
        ready:
          model !== undefined &&
          (auth === AgentAuth.Subscription
            ? subscription?.signedIn === true
            : states[AGENT_PROVIDER_SECRET[provider]] === SecretState.Saved),
      };
    },

    async choice(): Promise<AgentModelChoice> {
      const { provider, auth, model, thinking } = selection();

      if (!model) {
        throw new Error(`Pick a model for ${provider} in Settings first`);
      }

      // pi-ai reads the sign-in or the key through `credentials` for each request.
      if (auth === AgentAuth.Subscription) {
        if (!(await credentials.signedIn(provider))) {
          throw new Error(`Sign in to ${provider} in Settings first`);
        }
      } else if (
        (await secrets.states())[AGENT_PROVIDER_SECRET[provider]] !==
        SecretState.Saved
      ) {
        throw new Error(`Save an API key for ${provider} in Settings first`);
      }

      return { model, thinking };
    },

    /** Resolves once the sign-in is saved, or quietly once it is cancelled. */
    async signIn(locale: string) {
      const { provider, subscribable } = selection();

      if (!subscribable) {
        throw new Error(`${provider} has no subscription sign-in`);
      }

      if (signIn) throw new Error("A sign-in is already open");

      const current = { controller: new AbortController(), locale };

      signIn = current;

      try {
        await catalog.login(
          provider,
          "oauth",
          {
            signal: current.controller.signal,
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
      } catch (error) {
        if (!current.controller.signal.aborted) throw error;
      } finally {
        signIn = undefined;
      }
    },

    cancelSignIn() {
      signIn?.controller.abort();
    },

    async signOut() {
      await catalog.logout(selection().provider);
    },
  };
}

export type AgentModels = ReturnType<typeof createAgentModels>;
