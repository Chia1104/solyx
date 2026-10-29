import { noop } from "es-toolkit";

import { listenForSignIn } from "@solyx/agent/sign-in-callback";
import { PRODUCT_NAME } from "@solyx/api/product";
import { LONGBRIDGE_SIGN_IN_SECRET, SecretState } from "@solyx/api/settings";
import type { Locale } from "@solyx/api/settings";
import {
  deleteLongbridgeClient,
  exchangeLongbridgeCode,
  longbridgeAuthorizeUrl,
  longbridgeSignInSchema,
  refreshLongbridgeSignIn,
  registerLongbridgeClient,
} from "@solyx/longbridge/sign-in";
import type {
  LongbridgeClient,
  LongbridgeSignIn,
} from "@solyx/longbridge/sign-in";
import { MINUTE_MS } from "@solyx/utils/date";
import { parseJson } from "@solyx/utils/json";
import { pkceChallenge, randomToken } from "@solyx/utils/server";

import type { SecretStore } from "../settings/secret-store.ts";
import { SignInFlow, signInPage } from "../settings/sign-in-page.ts";

// A token this close to its expiry is refreshed first, so no request goes out on one about to lapse.
const REFRESH_AHEAD_MS = 5 * MINUTE_MS;

export interface LongbridgeAccessOptions {
  secrets: Pick<SecretStore, "get" | "save" | "delete" | "state">;
  /** Opens Longbridge's page in the system browser. */
  openExternal: (url: string) => void;
  fetch?: typeof fetch;
  /** @default Date.now */
  now?: () => number;
}

/**
 * The user's Longbridge sign-in for US quotes and fundamentals, sealed with the secrets. Each sign-in registers a
 * client of its own, whose browser returns to a loopback listener open only while it waits, and
 * replacing or ending a sign-in deletes its client, which takes it off the user's account.
 */
export function createLongbridgeAccess({
  secrets,
  openExternal,
  fetch,
  now = Date.now,
}: LongbridgeAccessOptions) {
  let refreshing: Promise<string> | undefined;
  let signingIn: AbortController | undefined;

  async function saved(): Promise<LongbridgeSignIn | undefined> {
    const value = await secrets.get(LONGBRIDGE_SIGN_IN_SECRET);

    return value === undefined
      ? undefined
      : parseJson(value, longbridgeSignInSchema);
  }

  async function refresh(signIn: LongbridgeSignIn): Promise<string> {
    const next = await refreshLongbridgeSignIn(signIn, { fetch, now });

    await secrets.save(LONGBRIDGE_SIGN_IN_SECRET, JSON.stringify(next));

    return next.accessToken;
  }

  const forget = (client: LongbridgeClient) =>
    deleteLongbridgeClient(client, { fetch }).catch(noop);

  return {
    /** The access token, refreshed first as it nears its expiry; rejects while signed out. */
    async accessToken(): Promise<string> {
      if (refreshing) return refreshing;

      const signIn = await saved();

      if (!signIn) {
        throw new Error(
          "Sign in to Longbridge in Settings for US quotes and fundamentals"
        );
      }

      if (signIn.expiresAt - now() > REFRESH_AHEAD_MS) {
        return signIn.accessToken;
      }

      // Longbridge rotates the refresh token, so two refreshes at once would spend it twice.
      refreshing ??= refresh(signIn).finally(() => {
        refreshing = undefined;
      });

      return refreshing;
    },

    /** The saved sign-in's client, which a refresh keeps and a new sign-in replaces. */
    async clientId(): Promise<string | undefined> {
      return (await saved())?.clientId;
    },

    async signedIn(): Promise<boolean> {
      return (
        (await secrets.state(LONGBRIDGE_SIGN_IN_SECRET)) === SecretState.Saved
      );
    },

    /** Signs in in the browser and saves the sign-in, replacing the one saved; resolves once saved or cancelled. */
    async signIn(locale: Locale): Promise<void> {
      signingIn?.abort();

      const controller = new AbortController();

      signingIn = controller;

      const state = randomToken();
      const verifier = randomToken();

      const callback = await listenForSignIn({
        name: "Longbridge",
        // Only Longbridge's redirect knows the path, and its state proves the return is this sign-in's.
        path: `/callback/${randomToken()}`,
        page: (outcome, detail) =>
          signInPage(locale, SignInFlow.Longbridge, outcome, detail),
        signal: controller.signal,
        verify: (query) => query.get("state") === state,
        accept: (query) => query.get("code") || undefined,
      });

      let client: LongbridgeClient | undefined;

      try {
        client = await registerLongbridgeClient({
          name: PRODUCT_NAME,
          redirectUri: callback.redirectUri,
          fetch,
        });

        openExternal(
          longbridgeAuthorizeUrl({
            client,
            state,
            challenge: pkceChallenge(verifier),
          })
        );

        const code = await callback.returned;

        const signIn = await exchangeLongbridgeCode(
          { client, code, verifier },
          { fetch, now }
        );

        const previous = await saved();

        await secrets.save(LONGBRIDGE_SIGN_IN_SECRET, JSON.stringify(signIn));

        if (previous) await forget(previous);
      } catch (error) {
        if (client) await forget(client);

        throw error;
      } finally {
        callback.close();

        if (signingIn === controller) signingIn = undefined;
      }
    },

    cancelSignIn() {
      signingIn?.abort();
    },

    /** Forgets the sign-in and deletes its client, which takes it off the user's account. */
    async signOut(): Promise<void> {
      const signIn = await saved();

      await secrets.delete(LONGBRIDGE_SIGN_IN_SECRET);

      if (signIn) await forget(signIn);
    },
  };
}

export type LongbridgeAccess = ReturnType<typeof createLongbridgeAccess>;
