import { createHash, randomBytes } from "node:crypto";

import type {
  LoginOptions,
  OAuthAuth,
  OAuthCredential,
  ProviderAuthInteraction,
} from "@earendil-works/pi-ai";
import * as z from "zod";

import { listenForSignIn } from "./sign-in-callback.ts";
import type { SignInPage } from "./sign-in-callback.ts";

// Sign in with ChatGPT for open-source, locally hosted apps:
// https://developers.openai.com/siwc/token-sharing-open-source/sign-in
const AUTHORIZE_URL = "https://auth.openai.com/api/accounts/authorize";

const TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token";

const RESOURCE = "https://api.openai.com/v1";

// Each sign-in registers the app anew; OpenAI returns the client id it issued in the callback.
const DYNAMIC_CLIENT_ID = "dynamic_agent_client";

const PLAN_SCOPE = "chatgpt.tokens.use.direct";

const SCOPE = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`;

const CALLBACK_PATH = "/auth/callback";

// Only the port of a loopback redirect may vary, so a busy 1455 falls back to any free port.
const PREFERRED_PORT = 1455;

// Refreshed this long before it expires, so no request starts with a token about to lapse.
const EXPIRY_MARGIN_MS = 3 * 60 * 1000;

export interface ChatGPTOAuthOptions {
  /** Shown on OpenAI's consent screen, the same on every installation. */
  appName: string;
  /** The page the browser lands on when the sign-in returns to this computer. */
  callbackPage: SignInPage;
  fetch?: typeof globalThis.fetch;
}

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
  scope: z.string(),
});

const random = () => randomBytes(32).toString("base64url");

/**
 * Signs in with ChatGPT so OpenAI requests run on the user's plan, replacing pi-ai's flow so the
 * consent screen names the app and the page the browser lands on is the app's own. The browser
 * returns to a loopback listener that is open only while the sign-in waits for it.
 */
export function chatgptOAuth(options: ChatGPTOAuthOptions): OAuthAuth {
  const fetch = options.fetch ?? globalThis.fetch;

  async function requestToken(body: URLSearchParams, signal: AbortSignal) {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
      signal,
    });

    if (!response.ok) {
      throw new Error(
        `ChatGPT sign-in failed (${response.status}): ${await response.text().catch(() => response.statusText)}`
      );
    }

    const token = tokenSchema.parse(await response.json());
    const scopes = token.scope.split(/\s+/).filter(Boolean);

    if (!scopes.includes(PLAN_SCOPE)) {
      throw new Error("ChatGPT did not grant use of the plan");
    }

    const credential: OAuthCredential = {
      type: "oauth",
      access: token.access_token,
      refresh: token.refresh_token,
      expires: Date.now() + token.expires_in * 1000 - EXPIRY_MARGIN_MS,
      scopes,
    };

    return credential;
  }

  async function login(
    interaction: ProviderAuthInteraction,
    loginOptions?: LoginOptions
  ): Promise<OAuthCredential> {
    const deviceId = loginOptions?.getDeviceId?.();

    if (!deviceId) {
      throw new Error("Sign in with ChatGPT needs this installation's id");
    }

    const verifier = random();
    const state = random();

    const callback = await listenForSignIn({
      name: "ChatGPT",
      path: CALLBACK_PATH,
      preferredPort: PREFERRED_PORT,
      page: options.callbackPage,
      signal: interaction.signal,
      accept(query) {
        const code = query.get("code");
        const clientId = query.get("client_id");

        return query.get("state") === state && code && clientId
          ? { code, clientId }
          : undefined;
      },
    });

    try {
      const authorize = new URL(AUTHORIZE_URL);

      authorize.search = new URLSearchParams({
        client_id: DYNAMIC_CLIENT_ID,
        agent_name_hint: options.appName,
        ext_agent_host_id: `urn:uuid:${deviceId.toLowerCase()}`,
        response_type: "code",
        redirect_uri: callback.redirectUri,
        resource: RESOURCE,
        scope: SCOPE,
        state,
        nonce: random(),
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
      }).toString();

      interaction.notify({ type: "auth_url", url: authorize.toString() });

      const { code, clientId } = await callback.returned;

      const credential = await requestToken(
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          code,
          code_verifier: verifier,
          redirect_uri: callback.redirectUri,
          resource: RESOURCE,
        }),
        interaction.signal
      );

      return { ...credential, clientId };
    } finally {
      callback.close();
    }
  }

  return {
    name: "OpenAI (ChatGPT subscription)",
    isSubscription: true,
    loginLabel: "Sign in with ChatGPT",
    login,

    async refresh(credential, signal) {
      const clientId = z.string().min(1).safeParse(credential.clientId).data;

      if (!clientId) {
        throw new Error(
          "The ChatGPT sign-in has no issued client id; sign in again"
        );
      }

      const refreshed = await requestToken(
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: credential.refresh,
          resource: RESOURCE,
        }),
        signal
      );

      // Tokens, expiry and scopes are replaced together; the refresh token rotates.
      return { ...refreshed, clientId };
    },

    toAuth: async (credential) => ({ apiKey: credential.access }),
  };
}
