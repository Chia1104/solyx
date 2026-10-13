import { escapeRegExp } from "es-toolkit";
import { expect, onTestFinished, test, vi } from "vite-plus/test";

import {
  DEFAULT_MODEL,
  createModelCatalog,
  subscriptionOf,
} from "../src/models.ts";
import type { ProviderCredentials, SignInOptions } from "../src/models.ts";
import type { AgentProvider } from "../src/providers.ts";

// No credential is ever saved here; sign-ins are cancelled before they return.
const NO_CREDENTIALS: ProviderCredentials = {
  read: async () => undefined,
  stored: async () => undefined,
  modify: async () => undefined,
  delete: async () => undefined,
};

// A sign-in that returns to no page and shows no code.
const QUIET: SignInOptions = { page: () => "", onCode: () => undefined };

function setup(
  endpoint: (provider: AgentProvider) => string | undefined = () => undefined,
  credentials: ProviderCredentials = NO_CREDENTIALS
) {
  const openExternal = vi.fn();

  const catalog = createModelCatalog({
    credentials,
    appName: "Solyx",
    getDeviceId: () => "00000000-0000-4000-8000-000000000000",
    openExternal,
    endpoint,
  });

  return { catalog, openExternal };
}

test("a model the provider does not list reads as its default", () => {
  const { catalog } = setup();

  expect(catalog.model("anthropic", "gone")?.id).toBe(DEFAULT_MODEL.anthropic);
  expect(catalog.model("anthropic", undefined)?.id).toBe(
    DEFAULT_MODEL.anthropic
  );
  expect(catalog.options("anthropic").map((option) => option.id)).toContain(
    DEFAULT_MODEL.anthropic
  );
});

test("every provider offered is set up with one key, and only those with a subscription also sign in", async () => {
  const { catalog } = setup();
  const offered = catalog.providers();

  expect(offered.length).toBeGreaterThan(4);
  expect(
    offered.map(({ id }) => id).filter((id) => subscriptionOf(id) !== undefined)
  ).toEqual(["meta", "openai", "xai"]);

  for (const { id } of offered) {
    const auth = catalog.models.getProvider(id)?.auth;
    const asked: string[] = [];

    await auth?.apiKey?.login?.({
      signal: AbortSignal.timeout(1000),
      notify: () => undefined,
      prompt: async (prompt) => {
        asked.push(prompt.type);

        return "key";
      },
    });

    expect({ id, asked }).toEqual({ id, asked: ["secret"] });
    expect({ id, oauth: auth?.oauth !== undefined }).toEqual({
      id,
      oauth: subscriptionOf(id) !== undefined,
    });
  }
});

test("providers that run on more than a key are not offered", () => {
  const { catalog } = setup();

  expect(catalog.offers("xai")).toBe(true);
  expect(catalog.offers("amazon-bedrock")).toBe(false);
  expect(catalog.offers("azure")).toBe(false);
  expect(catalog.offers("cloudflare-workers-ai")).toBe(false);
  expect(catalog.offers("nowhere")).toBe(false);
  expect(catalog.model("nowhere", undefined)).toBeUndefined();
});

// A provider that runs on the user's own resource, as Azure does, lists its models without one.
test("every model offered is served from an endpoint its provider names", () => {
  const { catalog } = setup();

  for (const { id } of catalog.providers()) {
    const unserved = catalog.models
      .getModels(id)
      .filter((model) => !model.baseUrl)
      .map((model) => model.id);

    expect({ id, unserved }).toEqual({ id, unserved: [] });
  }
});

test("each default model is one its provider's catalog lists", () => {
  const { catalog } = setup();

  for (const [provider, id] of Object.entries(DEFAULT_MODEL)) {
    expect({ provider, offered: catalog.offers(provider) }).toEqual({
      provider,
      offered: true,
    });
    expect(catalog.defaultModel(provider)).toBe(id);
  }

  for (const { id } of catalog.providers()) {
    expect(catalog.defaultModel(id)).toBeDefined();
  }
});

test("signing in again replaces a sign-in still open, and cancelling ends it quietly", async () => {
  const { catalog, openExternal } = setup();

  const first = catalog.signIn("openai", QUIET);

  await vi.waitFor(() => expect(openExternal).toHaveBeenCalledOnce());

  // Its browser page was closed, so the user starts over.
  const second = catalog.signIn("openai", QUIET);

  await expect(first).resolves.toBeUndefined();
  await vi.waitFor(() => expect(openExternal).toHaveBeenCalledTimes(2));

  catalog.cancelSignIn();

  await expect(second).resolves.toBeUndefined();
});

test("OpenRouter's sign-in opens its page and ends quietly, with no key, once cancelled", async () => {
  const { catalog, openExternal } = setup();

  expect(catalog.createsKey("openrouter")).toBe(true);
  expect(catalog.createsKey("openai")).toBe(false);

  const key = catalog.createKey("openrouter", () => "");

  await vi.waitFor(() => expect(openExternal).toHaveBeenCalledOnce());
  expect(openExternal).toHaveBeenCalledWith(
    expect.stringMatching(/^https:\/\/openrouter\.ai\/auth\?/)
  );

  catalog.cancelSignIn();

  await expect(key).resolves.toBeUndefined();
  await expect(catalog.createKey("openai", () => "")).rejects.toThrow(
    "creates no key by sign-in"
  );
});

test("only a provider with a subscription signs in", async () => {
  const { catalog } = setup();

  await expect(catalog.signIn("anthropic", QUIET)).rejects.toThrow(
    "no subscription sign-in"
  );
});

test("a sign-in by code shows the code, opens the provider's page and saves what it grants", async () => {
  const page = "https://accounts.x.ai/oauth2/device?user_code=WXYZ-1234";
  const asked: string[] = [];
  let saved: unknown;

  // xAI's device flow, shaped as its responses are.
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = String(input);

    asked.push(url);

    return url.endsWith("/device/code")
      ? Response.json({
          device_code: "device",
          user_code: "WXYZ-1234",
          verification_uri: "https://accounts.x.ai/oauth2/device",
          verification_uri_complete: page,
          interval: 1,
          expires_in: 600,
        })
      : Response.json({
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 3600,
        });
  });
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });

  const { catalog, openExternal } = setup(undefined, {
    ...NO_CREDENTIALS,
    async modify(_provider, change) {
      saved = await change(undefined);

      return undefined;
    },
  });

  const onCode = vi.fn();

  await catalog.signIn("xai", { page: () => "", onCode });

  expect(onCode).toHaveBeenCalledExactlyOnceWith({
    code: "WXYZ-1234",
    url: page,
  });
  expect(openExternal).toHaveBeenCalledExactlyOnceWith(page);
  expect(asked).toEqual([
    "https://auth.x.ai/oauth2/device/code",
    "https://auth.x.ai/oauth2/token",
  ]);
  expect(saved).toMatchObject({
    type: "oauth",
    access: "access",
    refresh: "refresh",
  });
});

test("a page that is not https is shown with its code and never opened", async () => {
  vi.stubGlobal("fetch", async () =>
    Response.json({
      device_code: "device",
      user_code: "WXYZ-1234",
      verification_uri: "http://auth.meta.example/device",
      interval: 1,
      expires_in: 600,
    })
  );
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });

  const { catalog, openExternal } = setup();
  const onCode = vi.fn();
  const signedIn = catalog.signIn("meta", { page: () => "", onCode });

  await vi.waitFor(() => expect(onCode).toHaveBeenCalledOnce());
  catalog.cancelSignIn();
  await signedIn;

  expect(onCode).toHaveBeenCalledWith({
    code: "WXYZ-1234",
    url: "http://auth.meta.example/device",
  });
  expect(openExternal).not.toHaveBeenCalled();
});

test("a request goes to the endpoint set for its provider, read for every request", async () => {
  const gateway = "https://gateway.example/anthropic";
  let endpoint: string | undefined;
  const requested: string[] = [];

  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    requested.push(input instanceof Request ? input.url : String(input));

    // Refused outright, so the request is not retried.
    return Response.json({ error: { message: "refused" } }, { status: 400 });
  });

  onTestFinished(() => {
    vi.unstubAllGlobals();
  });

  const { catalog } = setup((provider) =>
    provider === "anthropic" ? endpoint : undefined
  );

  const send = () =>
    catalog.models.complete(
      catalog.model("anthropic", undefined)!,
      { messages: [{ role: "user", content: "hi", timestamp: Date.now() }] },
      { apiKey: "sk-ant-test" }
    );

  await send();
  endpoint = gateway;
  await send();

  const own = catalog.defaultEndpoint("anthropic");

  expect(own).toBeDefined();
  expect(requested).toHaveLength(2);
  expect(requested[0]).toMatch(new RegExp(`^${escapeRegExp(own!)}/`));
  expect(requested[1]).toMatch(new RegExp(`^${escapeRegExp(gateway)}/`));
});

test("a provider whose models use several endpoints keeps its own", () => {
  const { catalog } = setup(() => "https://gateway.example");

  expect(catalog.defaultEndpoint("openrouter")).toBeUndefined();
  expect(
    catalog.models.getModels("openrouter").map((model) => model.baseUrl)
  ).not.toContain("https://gateway.example");
});
