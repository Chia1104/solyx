import { createHash, randomBytes } from "node:crypto";

import * as z from "zod";

import { listenForSignIn } from "./sign-in-callback.ts";
import type { SignInPage } from "./sign-in-callback.ts";

// OpenRouter's PKCE flow for apps, which ends in a key the user owns:
// https://openrouter.ai/docs/guides/overview/auth/oauth
const AUTHORIZE_URL = "https://openrouter.ai/auth";

const EXCHANGE_URL = "https://openrouter.ai/api/v1/auth/keys";

export interface OpenRouterKeyOptions {
  /** What OpenRouter labels the key it creates with. */
  appName: string;
  /** The page the browser lands on when the sign-in returns to this computer. */
  callbackPage: SignInPage;
  /** Opens OpenRouter's page in the system browser. */
  openExternal: (url: string) => void;
  /** Ends the sign-in. */
  signal: AbortSignal;
  fetch?: typeof globalThis.fetch;
}

const keySchema = z.object({ key: z.string().min(1) });

const random = () => randomBytes(32).toString("base64url");

/**
 * Signs in to OpenRouter in the browser, where the user has it create a key for the app, and
 * resolves with that key. The browser returns to a loopback listener that is open only while the
 * sign-in waits for it.
 */
export async function createOpenRouterKey(
  options: OpenRouterKeyOptions
): Promise<string> {
  const fetch = options.fetch ?? globalThis.fetch;
  const verifier = random();

  const callback = await listenForSignIn({
    name: "OpenRouter",
    // Only OpenRouter's redirect knows the path, so no other request passes for the sign-in's own.
    path: `/auth/callback/${random()}`,
    page: options.callbackPage,
    signal: options.signal,
    accept: (query) => query.get("code") || undefined,
  });

  try {
    const authorize = new URL(AUTHORIZE_URL);

    authorize.search = new URLSearchParams({
      callback_url: callback.redirectUri,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      key_label: options.appName,
    }).toString();

    options.openExternal(authorize.toString());

    const code = await callback.returned;

    const response = await fetch(EXCHANGE_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        code,
        code_verifier: verifier,
        code_challenge_method: "S256",
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      throw new Error(
        `OpenRouter sign-in failed (${response.status}): ${await response.text().catch(() => response.statusText)}`
      );
    }

    return keySchema.parse(await response.json()).key;
  } finally {
    callback.close();
  }
}
