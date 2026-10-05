import type { CredentialStore } from "@earendil-works/pi-ai";
import { escapeRegExp } from "es-toolkit";
import { expect, onTestFinished, test, vi } from "vite-plus/test";

import { createModelCatalog } from "../src/models.ts";
import { AgentProvider, DEFAULT_MODEL } from "../src/providers.ts";

// No credential is ever saved here; sign-ins are cancelled before they return.
const NO_CREDENTIALS: CredentialStore = {
  read: async () => undefined,
  list: async () => [],
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

  expect(catalog.model(AgentProvider.Anthropic, "gone")?.id).toBe(
    DEFAULT_MODEL[AgentProvider.Anthropic]
  );
  expect(catalog.model(AgentProvider.Anthropic, undefined)?.id).toBe(
    DEFAULT_MODEL[AgentProvider.Anthropic]
  );
  expect(
    catalog.options(AgentProvider.Anthropic).map((option) => option.id)
  ).toContain(DEFAULT_MODEL[AgentProvider.Anthropic]);
});

test("signing in again replaces a sign-in still open, and cancelling ends it quietly", async () => {
  const { catalog, openExternal } = setup();
  const page = () => "";

  const first = catalog.signIn(AgentProvider.OpenAI, page);

  await vi.waitFor(() => expect(openExternal).toHaveBeenCalledOnce());

  // Its browser page was closed, so the user starts over.
  const second = catalog.signIn(AgentProvider.OpenAI, page);

  await expect(first).resolves.toBeUndefined();
  await vi.waitFor(() => expect(openExternal).toHaveBeenCalledTimes(2));

  catalog.cancelSignIn();

  await expect(second).resolves.toBeUndefined();
});

test("only a provider with a subscription signs in", async () => {
  const { catalog } = setup();

  await expect(
    catalog.signIn(AgentProvider.Anthropic, () => "")
  ).rejects.toThrow("no subscription sign-in");
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
    provider === AgentProvider.Anthropic ? endpoint : undefined
  );

  const send = () =>
    catalog.models.complete(
      catalog.model(AgentProvider.Anthropic, undefined)!,
      { messages: [{ role: "user", content: "hi", timestamp: Date.now() }] },
      { apiKey: "sk-ant-test" }
    );

  await send();
  endpoint = gateway;
  await send();

  const own = catalog.defaultEndpoint(AgentProvider.Anthropic);

  expect(own).toBeDefined();
  expect(requested).toHaveLength(2);
  expect(requested[0]).toMatch(new RegExp(`^${escapeRegExp(own!)}/`));
  expect(requested[1]).toMatch(new RegExp(`^${escapeRegExp(gateway)}/`));
});

test("a provider whose models use several endpoints keeps its own", () => {
  const { catalog } = setup(() => "https://gateway.example");

  expect(catalog.defaultEndpoint(AgentProvider.OpenRouter)).toBeUndefined();
  expect(
    catalog.models
      .getModels(AgentProvider.OpenRouter)
      .map((model) => model.baseUrl)
  ).not.toContain("https://gateway.example");
});
