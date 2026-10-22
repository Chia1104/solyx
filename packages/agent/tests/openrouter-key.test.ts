import { createHash } from "node:crypto";

import { expect, test, vi } from "vite-plus/test";

import { createOpenRouterKey } from "../src/openrouter-key.ts";
import { SignInOutcome } from "../src/sign-in-callback.ts";

function setup(
  respond: () => Response = () => Response.json({ key: "sk-or-v1-test" })
) {
  const exchanges: { url: string; body: Record<string, string> }[] = [];

  const fetch = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      exchanges.push({
        url: String(url),
        body: JSON.parse(String(init?.body)),
      });

      return respond();
    }
  );

  const controller = new AbortController();
  let resolveUrl: (url: URL) => void = () => undefined;

  const authorizeUrl = new Promise<URL>((resolve) => {
    resolveUrl = resolve;
  });

  const key = createOpenRouterKey({
    appName: "Solyx",
    callbackPage: (outcome, detail) => `page:${outcome}:${detail ?? ""}`,
    openExternal: (url) => resolveUrl(new URL(url)),
    signal: controller.signal,
    fetch,
  });

  const callbackUrl = async () =>
    new URL((await authorizeUrl).searchParams.get("callback_url") ?? "");

  /** What the browser does once the user allows the key: it follows the redirect back here. */
  async function returnTo(params: Record<string, string>) {
    const callback = await callbackUrl();

    for (const [name, value] of Object.entries(params)) {
      callback.searchParams.set(name, value);
    }

    const response = await globalThis.fetch(callback);

    return { status: response.status, body: await response.text() };
  }

  return { key, authorizeUrl, callbackUrl, returnTo, exchanges, controller };
}

test("the key is labelled with the app's name and exchanged for the code the browser brings back", async () => {
  const { key, authorizeUrl, returnTo, exchanges } = setup();
  const url = await authorizeUrl;

  expect(url.origin + url.pathname).toBe("https://openrouter.ai/auth");
  expect(url.searchParams.get("key_label")).toBe("Solyx");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("callback_url")).toMatch(
    /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback\/[\w-]{43}$/
  );

  expect(await returnTo({ code: "code" })).toEqual({
    status: 200,
    body: `page:${SignInOutcome.SignedIn}:`,
  });

  await expect(key).resolves.toBe("sk-or-v1-test");

  const [exchange] = exchanges;

  expect(exchange.url).toBe("https://openrouter.ai/api/v1/auth/keys");
  expect(exchange.body).toMatchObject({
    code: "code",
    code_challenge_method: "S256",
  });
  // The verifier sent with the code is the one the challenge was made from.
  expect(
    createHash("sha256").update(exchange.body.code_verifier).digest("base64url")
  ).toBe(url.searchParams.get("code_challenge"));
});

test("a request that does not know the path is turned away and the sign-in keeps waiting", async () => {
  const { key, callbackUrl, returnTo, exchanges } = setup();

  const guess = new URL(
    "/auth/callback/guess?error=access_denied",
    await callbackUrl()
  );

  expect((await globalThis.fetch(guess)).status).toBe(404);
  expect(await returnTo({})).toMatchObject({
    status: 400,
    body: `page:${SignInOutcome.Failed}:`,
  });
  expect(exchanges).toEqual([]);

  await returnTo({ code: "code" });

  await expect(key).resolves.toBe("sk-or-v1-test");
});

test("a refusal from OpenRouter ends the sign-in and shows its code", async () => {
  const { key, returnTo, exchanges } = setup();

  const [page] = await Promise.all([
    returnTo({ error: "access_denied" }),
    expect(key).rejects.toThrow("access_denied"),
  ]);

  expect(page).toEqual({
    status: 400,
    body: `page:${SignInOutcome.Failed}:access_denied`,
  });
  expect(exchanges).toEqual([]);
});

test("a code OpenRouter does not take ends the sign-in with its reason", async () => {
  const { key, returnTo } = setup(() =>
    Response.json(
      { error: { message: "Invalid code or code_verifier" } },
      { status: 403 }
    )
  );

  await Promise.all([
    returnTo({ code: "code" }),
    expect(key).rejects.toThrow(
      /OpenRouter sign-in failed \(403\).*Invalid code or code_verifier/
    ),
  ]);
});

test("cancelling closes the listener", async () => {
  const { key, callbackUrl, controller } = setup();
  const callback = await callbackUrl();

  controller.abort();
  await expect(key).rejects.toThrow("Sign-in cancelled");
  await expect(globalThis.fetch(callback)).rejects.toThrow();
});
