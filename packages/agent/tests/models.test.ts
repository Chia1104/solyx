import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryModelsStore } from "@earendil-works/pi-ai";
import type { Credential } from "@earendil-works/pi-ai";
import { escapeRegExp } from "es-toolkit";
import { expect, onTestFinished, test, vi } from "vite-plus/test";

import {
  DEFAULT_MODEL,
  createModelCatalog,
  fileModelsStore,
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
  credentials: ProviderCredentials = NO_CREDENTIALS,
  {
    modelsStore = new InMemoryModelsStore(),
    fetch,
  }: { modelsStore?: InMemoryModelsStore; fetch?: typeof globalThis.fetch } = {}
) {
  const openExternal = vi.fn();

  const catalog = createModelCatalog({
    credentials,
    appName: "Solyx",
    getDeviceId: () => "00000000-0000-4000-8000-000000000000",
    openExternal,
    endpoint,
    modelsStore,
    fetch,
  });

  return { catalog, openExternal };
}

test("a model the provider does not list reads as its default", async () => {
  const { catalog } = setup();
  const options = await catalog.options("anthropic");

  expect((await catalog.model("anthropic", "gone"))?.id).toBe(
    DEFAULT_MODEL.anthropic
  );
  expect((await catalog.model("anthropic", undefined))?.id).toBe(
    DEFAULT_MODEL.anthropic
  );
  expect(options.map((option) => option.id)).toContain(DEFAULT_MODEL.anthropic);
});

test("every provider offered is set up with one key or a sign-in, and only those with a subscription sign in", async () => {
  const { catalog } = setup();
  const offered = catalog.providers();

  expect(offered.length).toBeGreaterThan(4);
  expect(
    offered.map(({ id }) => id).filter((id) => subscriptionOf(id) !== undefined)
  ).toEqual(["github-copilot", "meta", "openai", "xai"]);

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

    // A provider that runs on its sign-in alone takes no key.
    expect({ id, asked }).toEqual({
      id,
      asked: subscriptionOf(id)?.only ? [] : ["secret"],
    });
    expect({ id, oauth: auth?.oauth !== undefined }).toEqual({
      id,
      oauth: subscriptionOf(id) !== undefined,
    });
  }
});

test("providers that run on more than a key are not offered", async () => {
  const { catalog } = setup();

  expect(catalog.offers("xai")).toBe(true);
  expect(catalog.offers("amazon-bedrock")).toBe(false);
  expect(catalog.offers("azure")).toBe(false);
  expect(catalog.offers("cloudflare-workers-ai")).toBe(false);
  expect(catalog.offers("nowhere")).toBe(false);
  await expect(catalog.model("nowhere", undefined)).resolves.toBeUndefined();
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

test("each default model is one its provider's catalog lists", async () => {
  const { catalog } = setup();

  for (const [provider, id] of Object.entries(DEFAULT_MODEL)) {
    expect({ provider, offered: catalog.offers(provider) }).toEqual({
      provider,
      offered: true,
    });
    expect(await catalog.defaultModel(provider)).toBe(id);
  }

  // A server the user runs lists its models only once it is asked.
  for (const { id } of catalog.providers()) {
    if (catalog.servedByUser(id)) continue;

    expect(await catalog.defaultModel(id)).toBeDefined();
  }
});

test("Ollama lists the models its server holds there, keeps them for the next start and keeps them when it stops answering", async () => {
  const asked: string[] = [];
  let answering = true;

  const fetch = async (input: string | URL | Request) => {
    const { url } = new Request(input);

    asked.push(url);

    if (!answering) throw new TypeError("fetch failed");

    return Response.json({
      models: [
        {
          name: "qwen3.8:9b",
          capabilities: ["completion", "tools", "thinking"],
          details: { context_length: 262_144 },
        },
      ],
    });
  };

  const modelsStore = new InMemoryModelsStore();

  const endpoint = (provider: AgentProvider) =>
    provider === "ollama" ? "http://192.168.1.20:11434" : undefined;

  const { catalog } = setup(endpoint, NO_CREDENTIALS, { modelsStore, fetch });

  expect(catalog.offers("ollama")).toBe(true);
  expect(catalog.servedByUser("ollama")).toBe(true);
  expect(catalog.servedByUser("anthropic")).toBe(false);
  expect(catalog.defaultEndpoint("ollama")).toBe("http://127.0.0.1:11434");
  expect(await catalog.options("ollama")).toEqual([]);

  await catalog.refresh(["anthropic", "ollama"]);

  expect(asked).toEqual(["http://192.168.1.20:11434/api/tags"]);
  expect(await catalog.options("ollama")).toEqual([
    {
      provider: "ollama",
      id: "qwen3.8:9b",
      name: "qwen3.8:9b",
      reasoning: true,
      contextWindow: 65_536,
    },
  ]);
  expect((await catalog.model("ollama", undefined))?.baseUrl).toBe(
    "http://192.168.1.20:11434"
  );

  // The next start restores what was listed without asking the server.
  const restarted = setup(endpoint, NO_CREDENTIALS, { modelsStore, fetch });

  await restarted.catalog.restore();

  expect(asked).toHaveLength(1);
  expect(await restarted.catalog.defaultModel("ollama")).toBe("qwen3.8:9b");

  answering = false;
  await restarted.catalog.refresh(["ollama"]);

  expect(restarted.catalog.listingFailure("ollama")).toBe(
    "192.168.1.20:11434: fetch failed"
  );
  expect(await restarted.catalog.defaultModel("ollama")).toBe("qwen3.8:9b");
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

// The host sends this to its windows, so it holds what the page shows and nothing of the flow.
test("a provider's subscription is told by its plan and whether it takes a key, and nothing else", () => {
  expect(subscriptionOf("openai")).toEqual({ plan: "ChatGPT", only: false });
  expect(subscriptionOf("github-copilot")).toEqual({
    plan: "GitHub Copilot",
    only: true,
  });
  expect(subscriptionOf("openrouter")).toBeUndefined();
  expect(subscriptionOf("anthropic")).toBeUndefined();
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

test("GitHub Copilot signs in to github.com and offers the models its account has", async () => {
  const asked: string[] = [];
  let saved: Credential | undefined;

  // GitHub's device flow and Copilot's token and models, shaped as their responses are.
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = String(input);

    asked.push(url);

    if (url.endsWith("/login/device/code")) {
      return Response.json({
        device_code: "device",
        user_code: "WXYZ-1234",
        verification_uri: "https://github.com/login/device",
        interval: 1,
        expires_in: 900,
      });
    }

    if (url.endsWith("/login/oauth/access_token")) {
      return Response.json({ access_token: "ghu_test" });
    }

    if (url.endsWith("/copilot_internal/v2/token")) {
      return Response.json({
        token: "tid=1;exp=1;proxy-ep=proxy.individual.githubcopilot.com",
        expires_at: Math.floor(Date.now() / 1000) + 1800,
      });
    }

    return Response.json({
      data: ["gpt-5.4", "gpt-5-mini"].map((id) => ({
        id,
        model_picker_enabled: true,
        policy: { state: "enabled" },
        capabilities: { supports: { tool_calls: true } },
      })),
    });
  });
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });

  const { catalog, openExternal } = setup(undefined, {
    ...NO_CREDENTIALS,
    read: async () => saved,
    async modify(_provider, change) {
      saved = (await change(saved)) ?? saved;

      return saved;
    },
  });

  // Before a sign-in nothing says which models the account has, so all are listed.
  expect(await catalog.defaultModel("github-copilot")).toBe(
    DEFAULT_MODEL["github-copilot"]
  );
  expect(
    catalog.models.getProvider("github-copilot")?.auth.apiKey
  ).toBeUndefined();

  const onCode = vi.fn();

  await catalog.signIn("github-copilot", { page: () => "", onCode });

  expect(asked.slice(0, 4)).toEqual([
    "https://github.com/login/device/code",
    "https://github.com/login/oauth/access_token",
    "https://api.github.com/copilot_internal/v2/token",
    "https://api.individual.githubcopilot.com/models",
  ]);
  expect(onCode).toHaveBeenCalledExactlyOnceWith({
    code: "WXYZ-1234",
    url: "https://github.com/login/device",
  });
  expect(openExternal).toHaveBeenCalledExactlyOnceWith(
    "https://github.com/login/device"
  );
  expect(saved).toMatchObject({ type: "oauth", refresh: "ghu_test" });

  const options = await catalog.options("github-copilot");

  expect(options.map((option) => option.id)).toEqual(["gpt-5-mini", "gpt-5.4"]);
  // The preferred default is not one the account has, so its first model stands in.
  expect(await catalog.defaultModel("github-copilot")).toBe("gpt-5-mini");
  expect((await catalog.model("github-copilot", "gpt-5.4"))?.id).toBe(
    "gpt-5.4"
  );
  expect(
    (await catalog.model("github-copilot", DEFAULT_MODEL["github-copilot"]))?.id
  ).toBe("gpt-5-mini");
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

  const send = async () =>
    catalog.models.complete(
      (await catalog.model("anthropic", undefined))!,
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

test("the models kept for the next start live in one file, each provider's apart, and a file that does not parse holds none", async () => {
  const folder = await mkdtemp(join(tmpdir(), "solyx-models-"));

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  const file = join(folder, "agent-models.json");
  const store = fileModelsStore(file);

  const listed = {
    id: "qwen3.8:9b",
    name: "qwen3.8:9b",
    api: "ollama-chat",
    provider: "ollama",
    baseUrl: "http://127.0.0.1:11434",
    reasoning: true,
    input: ["text" as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 65_536,
    maxTokens: 16_384,
  };

  await store.write("ollama", { models: [listed], checkedAt: 1 });
  await store.write("other", { models: [] });

  expect(await store.read("ollama")).toEqual({
    models: [listed],
    checkedAt: 1,
  });

  await store.delete("other");

  expect(await store.read("other")).toBeUndefined();
  expect(await store.read("ollama")).toBeDefined();

  await writeFile(file, "{ not json");

  expect(await store.read("ollama")).toBeUndefined();
});

test("Ollama's models go back to this computer once its endpoint is set back, though the host set before listed them", async () => {
  let host: string | undefined = "http://192.168.1.20:11434";

  const fetch = async (input: string | URL | Request) => {
    const { url } = new Request(input);

    // Only the remote host answers, so going back keeps the list it gave.
    if (!url.startsWith("http://192.168.1.20"))
      throw new TypeError("fetch failed");

    return Response.json({
      models: [
        {
          name: "qwen3.8:9b",
          capabilities: ["completion", "tools"],
          details: { context_length: 262_144 },
        },
      ],
    });
  };

  const modelsStore = new InMemoryModelsStore();

  const endpoint = (provider: AgentProvider) =>
    provider === "ollama" ? host : undefined;

  const { catalog } = setup(endpoint, NO_CREDENTIALS, { modelsStore, fetch });

  await catalog.refresh(["ollama"]);
  host = undefined;
  await catalog.refresh(["ollama"]);

  expect(catalog.listingFailure("ollama")).toBe(
    "127.0.0.1:11434: fetch failed"
  );
  expect((await catalog.model("ollama", "qwen3.8:9b"))?.baseUrl).toBe(
    "http://127.0.0.1:11434"
  );

  // The next start reads the kept list on this computer's endpoint too.
  const restarted = setup(endpoint, NO_CREDENTIALS, { modelsStore, fetch });

  await restarted.catalog.restore();

  expect((await restarted.catalog.model("ollama", "qwen3.8:9b"))?.baseUrl).toBe(
    "http://127.0.0.1:11434"
  );
});
