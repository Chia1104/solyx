import { chatgptOAuth } from "@solyx/agent/chatgpt-oauth";
import { createModelCatalog } from "@solyx/agent/models";
import { AgentAuth, DEFAULT_MODEL } from "@solyx/agent/providers";
import type { AgentProvider } from "@solyx/agent/providers";
import type { AgentModelChoice } from "@solyx/agent/runtime";

import {
  AGENT_PROVIDER_SECRET,
  AGENT_SIGN_IN_SECRET,
  Locale,
  SecretState,
} from "#shared/ipc/settings.ts";
import type { AgentSettings } from "#shared/ipc/settings.ts";

import { PRODUCT_NAME } from "../../product.ts";
import type { ConfigFile } from "../settings/config-file.ts";
import type { AgentCredentials } from "../settings/credential-store.ts";
import type { SecretStore } from "../settings/secret-store.ts";
import { SignInFlow, signInPage } from "../settings/sign-in-page.ts";

const hasSubscription = (provider: AgentProvider) =>
  AGENT_SIGN_IN_SECRET[provider] !== undefined;

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
  credentials: AgentCredentials;
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
  credentials,
  getDeviceId,
  openExternal,
}: AgentModelsOptions) {
  // The sign-in that is open, if any, and the language its page is written in.
  let signIn: { controller: AbortController; locale: Locale } | undefined;

  const catalog = createModelCatalog(
    credentials,
    chatgptOAuth({
      // OpenAI shows it on the consent screen; development builds sign in under the same name.
      appName: PRODUCT_NAME,
      callbackPage: (outcome, detail) =>
        signInPage(
          signIn?.locale ?? Locale.EnUS,
          SignInFlow.ChatGPT,
          outcome,
          detail
        ),
    })
  );

  const keySaved = async (provider: AgentProvider) =>
    (await secrets.state(AGENT_PROVIDER_SECRET[provider])) ===
    SecretState.Saved;

  function selection() {
    const { provider, model, thinking } = config.read().agent;

    return {
      provider,
      subscribable: hasSubscription(provider),
      auth: agentAuth(config, provider),
      model:
        catalog.getModel(provider, model ?? DEFAULT_MODEL[provider]) ??
        catalog.getModel(provider, DEFAULT_MODEL[provider]),
      thinking,
    };
  }

  return {
    catalog,

    async settings(): Promise<AgentSettings> {
      const { provider, subscribable, auth, model, thinking } = selection();

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
            : await keySaved(provider)),
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
      } else if (!(await keySaved(provider))) {
        throw new Error(`Save an API key for ${provider} in Settings first`);
      }

      return { model, thinking };
    },

    /**
     * Resolves once the sign-in is saved, or quietly once it is cancelled. A sign-in still open,
     * such as one whose browser page was closed, gives way to the new one.
     */
    async signIn(locale: Locale) {
      const { provider, subscribable } = selection();

      if (!subscribable) {
        throw new Error(`${provider} has no subscription sign-in`);
      }

      signIn?.controller.abort();

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
        if (signIn === current) signIn = undefined;
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
