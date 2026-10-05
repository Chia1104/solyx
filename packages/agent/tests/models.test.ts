import { escapeRegExp } from "es-toolkit";
import { expect, onTestFinished, test, vi } from "vite-plus/test";

import { DEFAULT_MODEL, createModelCatalog } from "../src/models.ts";
import type { ProviderCredentials } from "../src/models.ts";
import type { AgentProvider } from "../src/providers.ts";

// No credential is ever saved here; sign-ins are cancelled before they return.
const NO_CREDENTIALS: ProviderCredentials = {
  read: async () => undefined,
  stored: async () => undefined,
  modify: async () => undefined,
  delete: async () => undefined,
};

function setup(
  endpoint: (provider: AgentProvider) => string | undefined = () => undefined
) {
  const openExternal = vi.fn();

  const catalog = createModelCatalog({
    credentials: NO_CREDENTIALS,
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

test("every provider offered is set up with one key, and only OpenAI also signs in", async () => {
  const { catalog } = setup();
  const offered = catalog.providers();

  expect(offered.length).toBeGreaterThan(4);

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
      oauth: id === "openai",
    });
  }
});

test("providers that run on more than a key are not offered", () => {
  const { catalog } = setup();

  expect(catalog.offers("xai")).toBe(true);
  expect(catalog.offers("amazon-bedrock")).toBe(false);
  expect(catalog.offers("cloudflare-workers-ai")).toBe(false);
  expect(catalog.offers("nowhere")).toBe(false);
  expect(catalog.model("nowhere", undefined)).toBeUndefined();
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
  const page = () => "";

  const first = catalog.signIn("openai", page);

  await vi.waitFor(() => expect(openExternal).toHaveBeenCalledOnce());

  // Its browser page was closed, so the user starts over.
  const second = catalog.signIn("openai", page);

  await expect(first).resolves.toBeUndefined();
  await vi.waitFor(() => expect(openExternal).toHaveBeenCalledTimes(2));

  catalog.cancelSignIn();

  await expect(second).resolves.toBeUndefined();
});

test("only a provider with a subscription signs in", async () => {
  const { catalog } = setup();

  await expect(catalog.signIn("anthropic", () => "")).rejects.toThrow(
    "no subscription sign-in"
  );
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
