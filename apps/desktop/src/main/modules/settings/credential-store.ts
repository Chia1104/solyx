import type {
  Credential,
  CredentialInfo,
  CredentialStore,
} from "@earendil-works/pi-ai";
import { Mutex } from "es-toolkit";
import * as z from "zod";

import { AgentProvider } from "@solyx/agent/providers";

import { Secret, SecretState } from "#shared/ipc/settings.ts";

import type { SecretStore } from "./secret-store.ts";

/** The secret each subscription sign-in's tokens are kept under, by pi-ai provider id. */
const CREDENTIAL_SECRET = new Map<string, Secret>([
  [AgentProvider.OpenAI, Secret.OpenAIChatGPT],
]);

// Loose, since flows keep their own fields beside the tokens, such as ChatGPT's issued client id.
const oauthCredentialSchema = z.looseObject({
  type: z.literal("oauth"),
  access: z.string(),
  refresh: z.string(),
  expires: z.number(),
});

function parseCredential(text: string): Credential | undefined {
  try {
    return oauthCredentialSchema.safeParse(JSON.parse(text)).data;
  } catch {
    return undefined;
  }
}

/**
 * pi-ai's store for subscription sign-ins, kept encrypted in the secret store. API keys stay in
 * their own secrets and ride on each request, so only OAuth credentials are stored here.
 */
export function createCredentialStore(secrets: SecretStore): CredentialStore {
  // pi-ai refreshes a token inside `modify`, so read-modify-write runs one at a time.
  const mutex = new Mutex();

  const secretOf = (providerId: string) => {
    const secret = CREDENTIAL_SECRET.get(providerId);

    if (!secret) throw new Error(`${providerId} has no subscription sign-in`);

    return secret;
  };

  async function read(providerId: string) {
    const secret = CREDENTIAL_SECRET.get(providerId);
    const text = secret ? await secrets.get(secret) : undefined;

    return text === undefined ? undefined : parseCredential(text);
  }

  return {
    read,

    async list() {
      const states = await secrets.states();

      return [...CREDENTIAL_SECRET].flatMap(
        ([providerId, secret]): CredentialInfo[] =>
          states[secret] === SecretState.Saved
            ? [{ providerId, type: "oauth" }]
            : []
      );
    },

    async modify(providerId, change) {
      const secret = secretOf(providerId);

      await mutex.acquire();

      try {
        const next = await change(await read(providerId));

        if (next === undefined) {
          await secrets.delete(secret);
        } else if (next.type === "oauth") {
          await secrets.save(secret, JSON.stringify(next));
        } else {
          throw new Error(
            "Only subscription sign-ins are stored; API keys ride on each request"
          );
        }

        return next;
      } finally {
        mutex.release();
      }
    },

    async delete(providerId) {
      await secrets.delete(secretOf(providerId));
    },
  };
}
