import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  onTestFinished,
  test,
  vi,
} from "vite-plus/test";

import { DEFAULT_MODEL } from "@solyx/agent/models";
import { AgentAuth, AgentThinking } from "@solyx/agent/providers";
import type { AgentProvider } from "@solyx/agent/providers";
import { MINUTE_MS } from "@solyx/utils/date";

import {
  Locale,
  Secret,
  SecretState,
  agentKeySecret,
  agentSignInSecret,
} from "#shared/settings.ts";
import type { SignInCode } from "#shared/settings.ts";

import { createAgentModels } from "../src/main/modules/agent/agent-models.ts";
import { createConfigFile } from "../src/main/modules/settings/config-file.ts";
import { createSecretStore } from "../src/main/modules/settings/secret-store.ts";

import { fakeCipher } from "./fake-cipher.ts";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-agent-models-"));
});

afterEach(() => rm(directory, { recursive: true, force: true }));

function setup(fetch?: typeof globalThis.fetch) {
  const config = createConfigFile(join(directory, "config.json"));

  const secrets = createSecretStore(
    join(directory, "secrets.json"),
    fakeCipher().cipher
  );

  config.create();

  const openExternal = vi.fn<(url: string) => void>();
  const showSignInCode = vi.fn<(code: SignInCode) => void>();
  const onModelsListed = vi.fn();

  const models = createAgentModels({
    config,
    secrets,
    getDeviceId: () => "00000000-0000-4000-8000-000000000000",
    openExternal,
    showSignInCode,
    modelsFile: join(directory, "agent-models.json"),
    onModelsListed,
    fetch,
  });

  return {
    config,
    secrets,
    models,
    openExternal,
    showSignInCode,
    onModelsListed,
  };
}

const providerOf = async (
  models: ReturnType<typeof setup>["models"],
  provider: AgentProvider
) =>
  (await models.settings()).providers.find(
    (each) => each.provider === provider
  );

describe("picking a model", () => {
  test("only providers switched on offer their models, the default model's always", async () => {
    const { config, models } = setup();

    config.set(["agent", "provider"], "anthropic");

    const offered = async () =>
      new Set((await models.settings()).models.map((model) => model.provider));

    expect(await offered()).toEqual(new Set(["anthropic"]));
    expect(await providerOf(models, "google")).toMatchObject({
      enabled: false,
    });

    config.set(["agent", "providers"], ["google"]);

    expect(await offered()).toEqual(new Set(["anthropic", "google"]));
  });

  test("a conversation runs on its own model, or on the default where it picked none", async () => {
    const { config, secrets, models } = setup();

    config.set(["agent", "provider"], "anthropic");
    config.set(["agent", "providers"], ["openai"]);
    await secrets.save(agentKeySecret("anthropic"), "sk-ant-test");
    await secrets.save(agentKeySecret("openai"), "sk-test");

    expect((await models.choice()).model.provider).toBe("anthropic");

    const picked = await models.choice({
      model: { provider: "openai", id: "gpt-6.1-sol" },
      thinking: AgentThinking.High,
    });

    expect(picked).toMatchObject({
      model: { provider: "openai", id: "gpt-6.1-sol" },
      thinking: AgentThinking.High,
    });
  });

  test("a model of a provider switched off, or without its key, does not run", async () => {
    const { config, secrets, models } = setup();

    const pick = {
      model: { provider: "google", id: "gemini-3.1-pro-preview" },
      thinking: null,
    };

    config.set(["agent", "provider"], "anthropic");
    await secrets.save(agentKeySecret("anthropic"), "sk-ant-test");

    await expect(models.choice(pick)).rejects.toThrow("switched off");

    config.set(["agent", "providers"], ["google"]);

    await expect(models.choice(pick)).rejects.toThrow("Save an API key");
  });

  test("the agent can run while a provider switched on can, whichever the default is", async () => {
    const { config, secrets, models } = setup();

    config.set(["agent", "provider"], "openai");
    await secrets.save(agentKeySecret("anthropic"), "sk-ant-test");

    expect((await models.settings()).ready).toBe(false);

    config.set(["agent", "providers"], ["anthropic"]);

    expect((await models.settings()).ready).toBe(true);
    await expect(models.choice()).rejects.toThrow("Save an API key for openai");
  });
});

describe("the providers offered", () => {
  test("go beyond the first few, each named and run on its own key", async () => {
    const { config, secrets, models } = setup();

    expect(await providerOf(models, "xai")).toMatchObject({
      name: "xAI",
      enabled: false,
      key: "missing",
      auth: AgentAuth.ApiKey,
    });

    config.set(["agent", "providers"], ["xai"]);
    await secrets.save(agentKeySecret("xai"), "xai-test");

    expect(await providerOf(models, "xai")).toMatchObject({
      enabled: true,
      key: "saved",
      usable: true,
    });

    const { model } = await models.choice({
      model: { provider: "xai", id: "gone" },
      thinking: null,
    });

    expect(model.id).toBe(DEFAULT_MODEL.xai);
  });

  test("stay on the settings page while switched on or set up, and off it otherwise", async () => {
    const { secrets, models } = setup();

    const listed = async () =>
      (await models.settings()).providers
        .filter((each) => each.listed)
        .map((each) => each.provider);

    expect(await listed()).toEqual(["anthropic"]);

    await models.setProviderEnabled("xai", true);
    await secrets.save(agentKeySecret("deepseek"), "sk-deepseek");

    expect(await listed()).toEqual(["anthropic", "deepseek", "xai"]);

    await models.setProviderEnabled("xai", false);
    await models.deleteKey("deepseek");

    expect(await listed()).toEqual(["anthropic"]);
  });

  test("keep their keys apart from every other secret the app saves", async () => {
    const { models } = setup();
    const others = new Set<string>(Object.values(Secret));

    for (const { provider } of (await models.settings()).providers) {
      expect(others.has(agentKeySecret(provider)), provider).toBe(false);
    }
  });

  test("leave out ids the app does not offer, wherever the config file names them", async () => {
    const { config, secrets, models } = setup();

    config.set(["agent", "provider"], "amazon-bedrock");
    config.set(["agent", "providers"], ["nowhere", "google"]);
    await secrets.save(agentKeySecret("anthropic"), "sk-ant-test");

    const settings = await models.settings();

    expect(settings.provider).toBe("anthropic");
    expect(settings.providers.map((each) => each.provider)).not.toContain(
      "amazon-bedrock"
    );
    expect(new Set(settings.models.map((model) => model.provider))).toEqual(
      new Set(["anthropic", "google"])
    );
    expect((await models.choice()).model.provider).toBe("anthropic");
    await expect(
      models.choice({
        model: { provider: "amazon-bedrock", id: "any" },
        thinking: null,
      })
    ).rejects.toThrow("no longer offered");
  });
});

describe("paying by subscription", () => {
  test("runs on the stored sign-in, with no key of its own", async () => {
    const { config, secrets, models } = setup();

    config.set(["agent", "provider"], "openai");
    config.set(["agent", "model"], "gpt-6.1-sol");
    config.set(["agent", "auth", "openai"], AgentAuth.Subscription);

    expect(await models.settings()).toMatchObject({ ready: false });
    expect(await providerOf(models, "openai")).toMatchObject({
      auth: AgentAuth.Subscription,
      subscription: { plan: "ChatGPT", signedIn: false },
      usable: false,
    });
    await expect(models.choice()).rejects.toThrow("Sign in to openai");

    await secrets.save(
      agentSignInSecret("openai"),
      JSON.stringify({
        type: "oauth",
        access: "access",
        refresh: "refresh",
        expires: Date.now() + MINUTE_MS,
      })
    );

    expect(await models.settings()).toMatchObject({ ready: true });
    expect(await providerOf(models, "openai")).toMatchObject({
      subscription: { plan: "ChatGPT", signedIn: true },
      usable: true,
    });

    expect((await models.choice()).model.id).toBe("gpt-6.1-sol");
  });

  test("keeps OpenAI's own endpoint, which an API key would leave for the one set", async () => {
    const { config, secrets, models } = setup();
    const gateway = "https://gateway.example/v1";

    config.set(["agent", "provider"], "openai");
    config.set(["agent", "endpoints", "openai"], gateway);
    await secrets.save(agentKeySecret("openai"), "sk-test");

    expect((await models.choice()).model.baseUrl).toBe(gateway);

    config.set(["agent", "auth", "openai"], AgentAuth.Subscription);
    await secrets.save(
      agentSignInSecret("openai"),
      JSON.stringify({
        type: "oauth",
        access: "access",
        refresh: "refresh",
        expires: Date.now() + MINUTE_MS,
      })
    );

    expect((await models.choice()).model.baseUrl).toBe(
      (await providerOf(models, "openai"))?.endpoint?.default
    );
  });

  test("a saved key does not stand in for a missing sign-in", async () => {
    const { config, secrets, models } = setup();

    config.set(["agent", "provider"], "openai");
    config.set(["agent", "auth", "openai"], AgentAuth.Subscription);
    await secrets.save(agentKeySecret("openai"), "sk-test");

    expect((await models.settings()).ready).toBe(false);
  });

  test("is picked provider by provider", async () => {
    const { secrets, models } = setup();

    await models.setProviderEnabled("xai", true);
    await models.setAuth("openai", AgentAuth.Subscription);
    await secrets.save(agentKeySecret("xai"), "xai-test");

    expect(await providerOf(models, "openai")).toMatchObject({
      auth: AgentAuth.Subscription,
      usable: false,
    });
    expect(await providerOf(models, "xai")).toMatchObject({
      auth: AgentAuth.ApiKey,
      subscription: { plan: "SuperGrok / X Premium", signedIn: false },
      usable: true,
    });

    await models.setAuth("xai", AgentAuth.Subscription);

    expect(await providerOf(models, "xai")).toMatchObject({ usable: false });
    await expect(
      models.setAuth("anthropic", AgentAuth.Subscription)
    ).rejects.toThrow("no subscription sign-in");
  });

  test("a sign-in by code shows its code and is saved under the provider's id", async () => {
    const { secrets, models, openExternal, showSignInCode } = setup();
    const page = "https://accounts.x.ai/oauth2/device?user_code=WXYZ-1234";

    // xAI's device flow, shaped as its responses are.
    vi.stubGlobal("fetch", async (input: string | URL | Request) =>
      String(input).endsWith("/device/code")
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
          })
    );
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });

    await models.setProviderEnabled("xai", true);
    await models.setAuth("xai", AgentAuth.Subscription);
    await models.signIn("xai", Locale.EnUS);

    expect(showSignInCode).toHaveBeenCalledExactlyOnceWith({
      provider: "xai",
      code: "WXYZ-1234",
      url: page,
    });
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(page);
    expect(
      JSON.parse((await secrets.get(agentSignInSecret("xai"))) ?? "")
    ).toMatchObject({ type: "oauth", access: "access", refresh: "refresh" });
    expect(await providerOf(models, "xai")).toMatchObject({
      subscription: { plan: "SuperGrok / X Premium", signedIn: true },
      usable: true,
    });

    await models.signOut("xai");

    expect(await providerOf(models, "xai")).toMatchObject({
      subscription: { signedIn: false },
      usable: false,
    });
  });

  test("is the only way a provider that takes no key runs, on the models its account has", async () => {
    const { config, secrets, models } = setup();

    await models.setProviderEnabled("github-copilot", true);

    expect(await providerOf(models, "github-copilot")).toMatchObject({
      name: "GitHub Copilot",
      auth: AgentAuth.Subscription,
      subscription: { plan: "GitHub Copilot", signedIn: false, only: true },
      usable: false,
    });
    await expect(
      models.setAuth("github-copilot", AgentAuth.ApiKey)
    ).rejects.toThrow("runs only on its subscription's sign-in");

    // A key saved for it by hand changes nothing.
    config.set(["agent", "auth", "github-copilot"], AgentAuth.ApiKey);
    await secrets.save(agentKeySecret("github-copilot"), "ghu_test");

    expect(await providerOf(models, "github-copilot")).toMatchObject({
      auth: AgentAuth.Subscription,
      usable: false,
    });

    await secrets.save(
      agentSignInSecret("github-copilot"),
      JSON.stringify({
        type: "oauth",
        access: "tid=1;exp=1;proxy-ep=proxy.individual.githubcopilot.com",
        refresh: "ghu_test",
        expires: Date.now() + 30 * MINUTE_MS,
        availableModelIds: ["gpt-5.4"],
      })
    );

    const settings = await models.settings();

    expect(
      settings.models
        .filter((model) => model.provider === "github-copilot")
        .map((model) => model.id)
    ).toEqual(["gpt-5.4"]);

    await models.setDefaultProvider("github-copilot");

    expect((await models.settings()).model).toBe("gpt-5.4");
    expect((await models.choice()).model.id).toBe("gpt-5.4");
  });

  test("applies only to providers that offer it", async () => {
    const { config, secrets, models } = setup();

    config.set(["agent", "provider"], "anthropic");
    config.set(["agent", "auth", "anthropic"], AgentAuth.Subscription);
    await secrets.save(agentKeySecret("anthropic"), "sk-ant-test");

    expect(await models.settings()).toMatchObject({ ready: true });
    expect(await providerOf(models, "anthropic")).toMatchObject({
      auth: AgentAuth.ApiKey,
      subscription: null,
      usable: true,
    });
    await expect(models.choice()).resolves.toBeDefined();
    await expect(models.signIn("anthropic", Locale.EnUS)).rejects.toThrow(
      "no subscription sign-in"
    );
  });
});

describe("a key the provider creates by sign-in", () => {
  /** OpenRouter answers the exchange; the browser's return to this computer goes through. */
  function stubOpenRouter() {
    const loopback = globalThis.fetch;

    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) =>
        String(input).startsWith("https://openrouter.ai/")
          ? Response.json({ key: "sk-or-v1-test" })
          : loopback(input, init)
    );
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });

    return loopback;
  }

  test("is saved as its API key once the browser returns", async () => {
    const { config, secrets, models, openExternal } = setup();
    const loopback = stubOpenRouter();

    config.set(["agent", "providers"], ["openrouter"]);

    expect(await providerOf(models, "openrouter")).toMatchObject({
      createsKey: true,
      key: "missing",
      usable: false,
    });
    expect(await providerOf(models, "anthropic")).toMatchObject({
      createsKey: false,
    });

    const created = models.createKey("openrouter", Locale.EnUS);

    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledOnce());

    const callback = new URL(
      new URL(openExternal.mock.calls[0][0]).searchParams.get("callback_url") ??
        ""
    );

    callback.searchParams.set("code", "code");

    expect(await (await loopback(callback)).text()).toContain(
      "Authorization sent to Solyx"
    );

    await created;

    expect(await secrets.get(agentKeySecret("openrouter"))).toBe(
      "sk-or-v1-test"
    );
    expect(await providerOf(models, "openrouter")).toMatchObject({
      key: "saved",
      usable: true,
    });
  });

  test("saves nothing once the sign-in is cancelled", async () => {
    const { secrets, models, openExternal } = setup();

    const created = models.createKey("openrouter", Locale.EnUS);

    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledOnce());
    models.cancelSignIn();
    await created;

    expect(await secrets.get(agentKeySecret("openrouter"))).toBeUndefined();
    await expect(models.createKey("openai", Locale.EnUS)).rejects.toThrow(
      "creates no key by sign-in"
    );
  });
});

describe("Ollama, a server the user runs", () => {
  /** Ollama holding one model that can run the agent, or not answering at all. */
  function fakeOllama() {
    const asked: { url: string; authorization: string | null }[] = [];
    let answering = true;

    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);

      asked.push({
        url: request.url,
        authorization: request.headers.get("authorization"),
      });

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

    return {
      fetch,
      asked,
      stop() {
        answering = false;
      },
    };
  }

  test("is asked nothing until switched on, then runs on no key once it lists a model", async () => {
    const ollama = fakeOllama();
    const { config, secrets, models, onModelsListed } = setup(ollama.fetch);

    config.set(["agent", "provider"], "anthropic");
    await secrets.save(agentKeySecret("anthropic"), "sk-ant-test");

    await models.listServerModels();

    expect(ollama.asked).toEqual([]);
    expect(await providerOf(models, "ollama")).toMatchObject({
      enabled: false,
      key: SecretState.Missing,
      usable: false,
      endpoint: {
        url: "http://127.0.0.1:11434",
        default: "http://127.0.0.1:11434",
      },
      server: { failure: null },
    });

    await models.setProviderEnabled("ollama", true);

    expect(ollama.asked).toEqual([
      { url: "http://127.0.0.1:11434/api/tags", authorization: null },
    ]);
    expect(onModelsListed).toHaveBeenCalledOnce();
    expect(await providerOf(models, "ollama")).toMatchObject({
      enabled: true,
      usable: true,
    });

    // Asking again finds the same models, so windows are not told to read it all again.
    expect(await models.serverModels("ollama")).toEqual({
      models: 1,
      failure: null,
    });
    expect(ollama.asked).toHaveLength(2);
    expect(onModelsListed).toHaveBeenCalledOnce();
    expect(
      await models.choice({
        model: { provider: "ollama", id: "qwen3.8:9b" },
        thinking: null,
      })
    ).toMatchObject({ model: { provider: "ollama", id: "qwen3.8:9b" } });
  });

  test("lists again where its endpoint and key move it, and keeps why it could not", async () => {
    const ollama = fakeOllama();
    const { models } = setup(ollama.fetch);

    await models.setProviderEnabled("ollama", true);
    await models.setEndpoint("ollama", "https://models.example.com/ollama");
    await models.saveKey("ollama", "proxy-token");

    expect(ollama.asked.at(-1)).toEqual({
      url: "https://models.example.com/ollama/api/tags",
      authorization: "Bearer proxy-token",
    });

    ollama.stop();

    expect(await models.serverModels("ollama")).toEqual({
      models: 1,
      failure: "models.example.com: fetch failed",
    });
    expect(await providerOf(models, "ollama")).toMatchObject({
      usable: true,
      server: { failure: "models.example.com: fetch failed" },
    });
  });

  test("a conversation on it says what model to pull while it holds none", async () => {
    const { models } = setup(async () => Response.json({ models: [] }));

    await models.setProviderEnabled("ollama", true);

    expect(await providerOf(models, "ollama")).toMatchObject({ usable: false });
    await expect(
      models.choice({
        model: { provider: "ollama", id: "qwen3.8:9b" },
        thinking: null,
      })
    ).rejects.toThrow("ollama holds no model that can run the agent");
  });
});
