import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { LONGBRIDGE_SIGN_IN_SECRET, Locale } from "@solyx/api/settings";
import { MINUTE_MS } from "@solyx/utils/date";

import { createLongbridgeAccess } from "../src/modules/market/longbridge-access.ts";
import { createSecretStore } from "../src/modules/settings/secret-store.ts";

import { fakeCipher } from "./fake-cipher.ts";

const NOW = Date.parse("2026-10-28T10:00:00Z");

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-longbridge-"));
});

afterEach(() => rm(directory, { recursive: true, force: true }));

function signIn(clientId: string, expiresAt: number) {
  return {
    clientId,
    redirectUri: "http://127.0.0.1:50000/callback/old",
    registration: {
      uri: `https://openapi.longbridge.com/oauth2/register/${clientId}`,
      token: `registration-${clientId}`,
    },
    accessToken: `hk_access_${clientId}`,
    refreshToken: `hk_refresh_${clientId}`,
    expiresAt,
  };
}

/** Plays Longbridge's OAuth endpoints, counting what each was asked. */
function setup() {
  const secrets = createSecretStore(
    join(directory, "secrets.json"),
    fakeCipher().cipher
  );

  const sent: Request[] = [];
  const opened: string[] = [];
  let tokens = 0;

  const fetch = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);

      sent.push(request);

      if (request.url.endsWith("/oauth2/register")) {
        return Response.json({
          client_id: "client-new",
          registration_client_uri:
            "https://openapi.longbridge.com/oauth2/register/client-new",
          registration_access_token: "registration-client-new",
        });
      }

      if (request.url.endsWith("/oauth2/token")) {
        tokens += 1;

        return Response.json({
          access_token: `hk_access_${tokens}`,
          refresh_token: `hk_refresh_${tokens}`,
          expires_in: 1_209_600,
        });
      }

      return new Response(null, { status: 204 });
    }
  );

  const access = createLongbridgeAccess({
    secrets,
    openExternal: (url) => opened.push(url),
    fetch,
    now: () => NOW,
  });

  const save = (value: ReturnType<typeof signIn>) =>
    secrets.save(LONGBRIDGE_SIGN_IN_SECRET, JSON.stringify(value));

  const saved = async () =>
    JSON.parse((await secrets.get(LONGBRIDGE_SIGN_IN_SECRET)) ?? "null");

  return { secrets, access, sent, opened, save, saved };
}

test("hands out a token while it has time left, and refreshes one about to expire, keeping the rotated tokens", async () => {
  const { access, sent, save, saved } = setup();

  await save(signIn("client-1", NOW + 10 * MINUTE_MS));

  expect(await access.accessToken()).toBe("hk_access_client-1");
  expect(sent).toHaveLength(0);

  await save(signIn("client-1", NOW + MINUTE_MS));

  expect(await access.accessToken()).toBe("hk_access_1");
  expect(await saved()).toMatchObject({
    clientId: "client-1",
    accessToken: "hk_access_1",
    refreshToken: "hk_refresh_1",
    expiresAt: NOW + 1_209_600_000,
  });
});

test("refreshes once for every request waiting on a token, since a refresh spends the refresh token", async () => {
  const { access, sent, save } = setup();

  await save(signIn("client-1", NOW));

  const tokens = await Promise.all([
    access.accessToken(),
    access.accessToken(),
    access.accessToken(),
  ]);

  expect(tokens).toEqual(["hk_access_1", "hk_access_1", "hk_access_1"]);
  expect(sent.filter(({ url }) => url.endsWith("/oauth2/token"))).toHaveLength(
    1
  );
});

test("has no token while signed out", async () => {
  const { access } = setup();

  expect(await access.signedIn()).toBe(false);
  await expect(access.accessToken()).rejects.toThrow(
    "Sign in to Longbridge in Settings for US quotes and fundamentals"
  );
});

test("signs in in the browser, saves the sign-in, and deletes the client of the one it replaces", async () => {
  const { access, sent, opened, save, saved } = setup();

  await save(signIn("client-old", NOW));

  const signingIn = access.signIn(Locale.EnUS);

  await expect.poll(() => opened.length).toBe(1);

  const authorize = new URL(opened[0]);
  const redirect = new URL(authorize.searchParams.get("redirect_uri") ?? "");

  // The browser returns to this computer with the code.
  redirect.searchParams.set("code", "hk_code");
  redirect.searchParams.set("state", authorize.searchParams.get("state") ?? "");

  const page = await fetch(redirect);

  expect(page.status).toBe(200);

  await signingIn;

  expect(await saved()).toMatchObject({
    clientId: "client-new",
    redirectUri: authorize.searchParams.get("redirect_uri"),
    accessToken: "hk_access_1",
  });
  expect(await access.clientId()).toBe("client-new");

  const deleted = sent.filter(({ method }) => method === "DELETE");

  expect(deleted.map(({ url }) => url)).toEqual([
    "https://openapi.longbridge.com/oauth2/register/client-old",
  ]);
});

test("a return without the sign-in's state does not end it", async () => {
  const { access, opened, saved } = setup();

  const signingIn = access.signIn(Locale.EnUS);

  await expect.poll(() => opened.length).toBe(1);

  const authorize = new URL(opened[0]);
  const redirect = new URL(authorize.searchParams.get("redirect_uri") ?? "");

  redirect.searchParams.set("code", "hk_code");
  redirect.searchParams.set("state", "forged");

  expect((await fetch(redirect)).status).toBe(400);

  access.cancelSignIn();

  await expect(signingIn).rejects.toThrow("Sign-in cancelled");
  expect(await saved()).toBeNull();
});

test("a cancelled sign-in saves nothing and deletes the client it registered", async () => {
  const { access, sent, opened, saved } = setup();

  const signingIn = access.signIn(Locale.EnUS);

  await expect.poll(() => opened.length).toBe(1);

  access.cancelSignIn();

  await expect(signingIn).rejects.toThrow("Sign-in cancelled");
  expect(await saved()).toBeNull();
  expect(
    sent.filter(({ method }) => method === "DELETE").map(({ url }) => url)
  ).toEqual(["https://openapi.longbridge.com/oauth2/register/client-new"]);
});

test("signing out forgets the sign-in and deletes its client", async () => {
  const { access, sent, save, saved } = setup();

  await save(signIn("client-1", NOW + 10 * MINUTE_MS));
  await access.signOut();

  expect(await saved()).toBeNull();
  expect(await access.signedIn()).toBe(false);
  expect(sent.map(({ method, url }) => `${method} ${url}`)).toEqual([
    "DELETE https://openapi.longbridge.com/oauth2/register/client-1",
  ]);
});
