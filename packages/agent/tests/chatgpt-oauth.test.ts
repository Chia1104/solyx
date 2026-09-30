import { createHash } from "node:crypto";
import { createServer } from "node:net";

import type { OAuthCredential } from "@earendil-works/pi-ai";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { SignInOutcome, chatgptOAuth } from "../src/chatgpt-oauth.ts";

const DEVICE_ID = "0D0B7F4E-8C1A-4B7E-9F55-3E4A2B1C0D9E";

const PLAN_SCOPES =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";

function tokenResponse(scope = PLAN_SCOPES) {
  return Response.json({
    access_token: "access",
    refresh_token: "refresh",
    id_token: "id",
    expires_in: 3600,
    scope,
  });
}

function setup(respond: () => Response = () => tokenResponse()) {
  const requests: URLSearchParams[] = [];

  const fetch = vi.fn(
    async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(new URLSearchParams(String(init?.body)));

      return respond();
    }
  );

  const oauth = chatgptOAuth({
    appName: "Solyx",
    callbackPage: (outcome, detail) => `page:${outcome}:${detail ?? ""}`,
    fetch,
  });

  const controller = new AbortController();
  let resolveUrl: (url: URL) => void = () => undefined;

  const authorizeUrl = new Promise<URL>((resolve) => {
    resolveUrl = resolve;
  });

  const login = oauth.login(
    {
      signal: controller.signal,
      prompt: () => Promise.reject(new Error("no prompts")),
      notify: (event) => {
        if (event.type === "auth_url") resolveUrl(new URL(event.url));
      },
    },
    { getDeviceId: () => DEVICE_ID }
  );

  /** What the browser does once the user approves: it follows the redirect back here. */
  async function returnTo(params: Record<string, string>) {
    const url = await authorizeUrl;
    const callback = new URL(url.searchParams.get("redirect_uri") ?? "");

    for (const [key, value] of Object.entries(params)) {
      callback.searchParams.set(key, value);
    }

    const response = await globalThis.fetch(callback);

    return { status: response.status, body: await response.text() };
  }

  return { oauth, login, authorizeUrl, returnTo, requests, controller };
}

const busy: { close: () => void }[] = [];

afterEach(() => {
  for (const server of busy.splice(0)) server.close();
});

test("the consent screen names the app and the browser returns to a loopback listener", async () => {
  const { login, authorizeUrl, returnTo, requests } = setup();
  const url = await authorizeUrl;
  const state = url.searchParams.get("state") ?? "";

  expect(url.origin + url.pathname).toBe(
    "https://auth.openai.com/api/accounts/authorize"
  );
  expect(url.searchParams.get("client_id")).toBe("dynamic_agent_client");
  expect(url.searchParams.get("agent_name_hint")).toBe("Solyx");
  expect(url.searchParams.get("ext_agent_host_id")).toBe(
    `urn:uuid:${DEVICE_ID.toLowerCase()}`
  );
  expect(url.searchParams.get("scope")).toBe(PLAN_SCOPES);
  expect(url.searchParams.get("redirect_uri")).toMatch(
    /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/
  );

  expect(
    await returnTo({ code: "code", state, client_id: "oaiapp_1" })
  ).toEqual({ status: 200, body: `page:${SignInOutcome.SignedIn}:` });

  const credential = await login;
  const [exchange] = requests;

  expect(credential).toMatchObject({
    type: "oauth",
    access: "access",
    refresh: "refresh",
    clientId: "oaiapp_1",
  });
  expect(exchange.get("grant_type")).toBe("authorization_code");
  expect(exchange.get("client_id")).toBe("oaiapp_1");
  expect(exchange.get("redirect_uri")).toBe(
    url.searchParams.get("redirect_uri")
  );
  // The verifier sent with the code is the one the challenge was made from.
  expect(
    createHash("sha256")
      .update(exchange.get("code_verifier") ?? "")
      .digest("base64url")
  ).toBe(url.searchParams.get("code_challenge"));
});

test("a callback with the wrong state is turned away and the sign-in keeps waiting", async () => {
  const { login, authorizeUrl, returnTo } = setup();
  const state = (await authorizeUrl).searchParams.get("state") ?? "";

  expect(
    await returnTo({ code: "code", state: "forged", client_id: "oaiapp_1" })
  ).toMatchObject({ status: 400, body: `page:${SignInOutcome.Failed}:` });

  await returnTo({ code: "code", state, client_id: "oaiapp_1" });

  await expect(login).resolves.toMatchObject({ clientId: "oaiapp_1" });
});

test("a refusal from OpenAI ends the sign-in and shows its code", async () => {
  const { login, returnTo } = setup();

  const [page] = await Promise.all([
    returnTo({ error: "access_denied" }),
    expect(login).rejects.toThrow("access_denied"),
  ]);

  expect(page).toEqual({
    status: 400,
    body: `page:${SignInOutcome.Failed}:access_denied`,
  });
});

test("a grant without use of the plan is not saved", async () => {
  const { login, authorizeUrl, returnTo } = setup(() =>
    tokenResponse("openid profile email offline_access")
  );

  const state = (await authorizeUrl).searchParams.get("state") ?? "";

  await Promise.all([
    returnTo({ code: "code", state, client_id: "oaiapp_1" }),
    expect(login).rejects.toThrow("did not grant use of the plan"),
  ]);
});

test("a busy preferred port falls back to another one", async () => {
  const blocker = createServer();

  await new Promise<void>((resolve, reject) => {
    blocker.once("error", reject).listen(1455, "127.0.0.1", resolve);
  }).catch(() => undefined);
  busy.push(blocker);

  const { login, authorizeUrl, controller } = setup();

  const redirect = new URL(
    (await authorizeUrl).searchParams.get("redirect_uri") ?? ""
  );

  expect(redirect.port).not.toBe("1455");

  controller.abort();
  await expect(login).rejects.toThrow("cancelled");
});

test("cancelling closes the listener", async () => {
  const { login, authorizeUrl, controller } = setup();
  const redirect = (await authorizeUrl).searchParams.get("redirect_uri") ?? "";

  controller.abort();
  await expect(login).rejects.toThrow("Sign-in cancelled");
  await expect(globalThis.fetch(redirect)).rejects.toThrow();
});

test("a refresh rotates the tokens and keeps the issued client", async () => {
  const { oauth, requests } = setup();

  const stored: OAuthCredential = {
    type: "oauth",
    access: "old",
    refresh: "old-refresh",
    expires: 0,
    clientId: "oaiapp_1",
  };

  const refreshed = await oauth.refresh(stored, new AbortController().signal);

  expect(refreshed).toMatchObject({
    access: "access",
    refresh: "refresh",
    clientId: "oaiapp_1",
  });
  expect(refreshed.expires).toBeGreaterThan(Date.now());
  expect(requests.at(-1)?.get("refresh_token")).toBe("old-refresh");
  await expect(
    oauth.refresh(
      { ...stored, clientId: undefined },
      new AbortController().signal
    )
  ).rejects.toThrow("sign in again");
});
