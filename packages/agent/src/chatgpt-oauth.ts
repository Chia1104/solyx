import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { Server, ServerResponse } from "node:http";

import type {
  LoginOptions,
  OAuthAuth,
  OAuthCredential,
  ProviderAuthInteraction,
} from "@earendil-works/pi-ai";
import { noop } from "es-toolkit";
import * as z from "zod";

// Sign in with ChatGPT for open-source, locally hosted apps:
// https://developers.openai.com/siwc/token-sharing-open-source/sign-in
const AUTHORIZE_URL = "https://auth.openai.com/api/accounts/authorize";

const TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token";

const RESOURCE = "https://api.openai.com/v1";

// Each sign-in registers the app anew; OpenAI returns the client id it issued in the callback.
const DYNAMIC_CLIENT_ID = "dynamic_agent_client";

const PLAN_SCOPE = "chatgpt.tokens.use.direct";

const SCOPE = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`;

const CALLBACK_HOST = "127.0.0.1";

const CALLBACK_PATH = "/auth/callback";

// Only the port of a loopback redirect may vary, so a busy 1455 falls back to any free port.
const PREFERRED_PORT = 1455;

// Refreshed this long before it expires, so no request starts with a token about to lapse.
const EXPIRY_MARGIN_MS = 3 * 60 * 1000;

export const SignInOutcome = {
  SignedIn: "signed-in",
  Failed: "failed",
} as const;

export type SignInOutcome = (typeof SignInOutcome)[keyof typeof SignInOutcome];

export interface ChatGPTOAuthOptions {
  /** Shown on OpenAI's consent screen, the same on every installation. */
  appName: string;
  /** The page the browser lands on when the sign-in returns to this computer. */
  callbackPage(outcome: SignInOutcome, detail?: string): string;
  fetch?: typeof globalThis.fetch;
}

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
  scope: z.string(),
});

const addressSchema = z.object({ port: z.number() });

const random = () => randomBytes(32).toString("base64url");

interface Callback {
  code: string;
  clientId: string;
}

function listen(server: Server, port: number) {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, CALLBACK_HOST, () => {
      server.off("error", reject);

      // Port 0 asks the OS for one, so the listener reports which it got.
      resolve(addressSchema.parse(server.address()).port);
    });
  });
}

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
    let settle: (callback: Callback) => void = noop;
    let fail: (error: Error) => void = noop;

    const returned = new Promise<Callback>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });

    const page = (
      response: ServerResponse,
      status: number,
      outcome: SignInOutcome,
      detail?: string
    ) => {
      response.writeHead(status, {
        "content-type": "text/html; charset=utf-8",
      });
      response.end(options.callbackPage(outcome, detail));
    };

    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", `http://${CALLBACK_HOST}`);

      if (url.pathname !== CALLBACK_PATH) {
        response.writeHead(404).end();

        return;
      }

      const error = url.searchParams.get("error");

      if (error) {
        page(response, 400, SignInOutcome.Failed, error);
        fail(new Error(`ChatGPT sign-in failed: ${error}`));

        return;
      }

      const code = url.searchParams.get("code");
      const clientId = url.searchParams.get("client_id");

      // A stray or replayed request fails on its own; the sign-in keeps waiting for the real one.
      if (url.searchParams.get("state") !== state || !code || !clientId) {
        page(response, 400, SignInOutcome.Failed);

        return;
      }

      page(response, 200, SignInOutcome.SignedIn);
      settle({ code, clientId });
    });

    const abort = () => fail(new Error("Sign-in cancelled"));

    interaction.signal.addEventListener("abort", abort, { once: true });

    try {
      const port = await listen(server, PREFERRED_PORT).catch(() =>
        listen(server, 0)
      );

      const redirectUri = `http://${CALLBACK_HOST}:${port}${CALLBACK_PATH}`;
      const authorize = new URL(AUTHORIZE_URL);

      authorize.search = new URLSearchParams({
        client_id: DYNAMIC_CLIENT_ID,
        agent_name_hint: options.appName,
        ext_agent_host_id: `urn:uuid:${deviceId.toLowerCase()}`,
        response_type: "code",
        redirect_uri: redirectUri,
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

      const { code, clientId } = await returned;

      const credential = await requestToken(
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          code,
          code_verifier: verifier,
          redirect_uri: redirectUri,
          resource: RESOURCE,
        }),
        interaction.signal
      );

      return { ...credential, clientId };
    } finally {
      interaction.signal.removeEventListener("abort", abort);
      server.close();
      // A browser's spare connection would otherwise keep the listener, and the port, alive.
      server.closeAllConnections();
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
