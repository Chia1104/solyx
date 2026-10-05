import type { ApiKeyCredential, OAuthCredential } from "@earendil-works/pi-ai";
import { Mutex } from "es-toolkit";
import * as z from "zod";

import type { ProviderCredentials } from "@solyx/agent/models";
import type { AgentProvider } from "@solyx/agent/providers";

import {
  SecretState,
  agentKeySecret,
  agentSignInSecret,
} from "#shared/ipc/settings.ts";

import type { SecretStore } from "./secret-store.ts";

// Loose, since flows keep their own fields beside the tokens, such as ChatGPT's issued client id.
const oauthCredentialSchema = z.looseObject({
  type: z.literal("oauth"),
  access: z.string(),
  refresh: z.string(),
  expires: z.number(),
});

function parseSignIn(text: string): OAuthCredential | undefined {
  try {
    return oauthCredentialSchema.safeParse(JSON.parse(text)).data;
  } catch {
    return undefined;
  }
}

export interface AgentCredentials extends ProviderCredentials {
  /** Whether the provider's subscription sign-in is saved, whatever it runs on now. */
  signedIn(provider: AgentProvider): Promise<boolean>;
}

/**
 * pi-ai's credentials, kept encrypted in the secret store: a provider's subscription sign-in while
 * it runs on one, otherwise the API key saved for it. Sign-in flows and refreshes write sign-ins
 * here; API keys are saved only from the settings page, so here they are read and never written.
 */
export function createCredentialStore(
  secrets: SecretStore,
  /** Whether the user runs `provider` on its subscription rather than on a key. */
  runsOnSubscription: (provider: AgentProvider) => boolean
): AgentCredentials {
  // pi-ai refreshes a token inside `modify`, so read-modify-write runs one at a time.
  const mutex = new Mutex();

  const signInSecretOf = (providerId: string) => {
    const secret = agentSignInSecret(providerId);

    if (!secret) throw new Error(`${providerId} has no subscription sign-in`);

    return secret;
  };

  async function readSignIn(providerId: string) {
    const secret = agentSignInSecret(providerId);
    const text = secret ? await secrets.get(secret) : undefined;

    return text === undefined ? undefined : parseSignIn(text);
  }

  async function readKey(
    provider: AgentProvider
  ): Promise<ApiKeyCredential | undefined> {
    const key = await secrets.get(agentKeySecret(provider));

    return key ? { type: "api_key", key } : undefined;
  }

  return {
    read: (provider) =>
      runsOnSubscription(provider) ? readSignIn(provider) : readKey(provider),

    async stored(provider) {
      const subscription = runsOnSubscription(provider);

      const secret = subscription
        ? agentSignInSecret(provider)
        : agentKeySecret(provider);

      if (
        secret === undefined ||
        (await secrets.state(secret)) !== SecretState.Saved
      ) {
        return undefined;
      }

      return subscription ? "oauth" : "api_key";
    },

    async modify(providerId, change) {
      const secret = signInSecretOf(providerId);

      await mutex.acquire();

      try {
        const current = await readSignIn(providerId);
        const next = await change(current);

        // pi-ai leaves a sign-in as it is, such as one another request already refreshed.
        if (next === undefined) return current;

        if (next.type !== "oauth") {
          throw new Error(
            "Only subscription sign-ins are stored here; API keys are saved in Settings"
          );
        }

        await secrets.save(secret, JSON.stringify(next));

        return next;
      } finally {
        mutex.release();
      }
    },

    async delete(providerId) {
      await secrets.delete(signInSecretOf(providerId));
    },

    async signedIn(provider) {
      const secret = agentSignInSecret(provider);

      return (
        secret !== undefined &&
        (await secrets.state(secret)) === SecretState.Saved
      );
    },
  };
}
