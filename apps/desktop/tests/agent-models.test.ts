import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { DEFAULT_MODEL } from "@solyx/agent/models";
import { AgentAuth, AgentThinking } from "@solyx/agent/providers";
import type { AgentProvider } from "@solyx/agent/providers";

import { Locale, Secret, agentKeySecret } from "#shared/ipc/settings.ts";

import { createAgentModels } from "../src/main/modules/agent/agent-models.ts";
import { createConfigFile } from "../src/main/modules/settings/config-file.ts";
import { createSecretStore } from "../src/main/modules/settings/secret-store.ts";

import { fakeCipher } from "./fake-cipher.ts";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-agent-models-"));
});

afterEach(() => rm(directory, { recursive: true, force: true }));

function setup() {
  const config = createConfigFile(join(directory, "config.jsonc"));

  const secrets = createSecretStore(
    join(directory, "secrets.json"),
    fakeCipher().cipher
  );

  config.create();

  const models = createAgentModels({
    config,
    secrets,
    getDeviceId: () => "00000000-0000-4000-8000-000000000000",
    openExternal: vi.fn(),
  });

  return { config, secrets, models };
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
});

describe("the providers offered", () => {
  test("go beyond the first few, each named and run on its own key", async () => {
    const { config, secrets, models } = setup();

    expect(await providerOf(models, "xai")).toMatchObject({
      name: "xAI",
      enabled: false,
      key: "missing",
      subscription: null,
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
    config.set(["agent", "auth"], AgentAuth.Subscription);

    expect(await models.settings()).toMatchObject({ ready: false });
    expect(await providerOf(models, "openai")).toMatchObject({
      auth: AgentAuth.Subscription,
      subscription: { signedIn: false },
      usable: false,
    });
    await expect(models.choice()).rejects.toThrow("Sign in to openai");

    await secrets.save(
      Secret.OpenAIChatGPT,
      JSON.stringify({
        type: "oauth",
        access: "access",
        refresh: "refresh",
        expires: Date.now() + 60_000,
      })
    );

    expect(await models.settings()).toMatchObject({ ready: true });
    expect(await providerOf(models, "openai")).toMatchObject({
      subscription: { signedIn: true },
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

    config.set(["agent", "auth"], AgentAuth.Subscription);
    await secrets.save(
      Secret.OpenAIChatGPT,
      JSON.stringify({
        type: "oauth",
        access: "access",
        refresh: "refresh",
        expires: Date.now() + 60_000,
      })
    );

    expect((await models.choice()).model.baseUrl).toBe(
      (await providerOf(models, "openai"))?.endpoint?.default
    );
  });

  test("a saved key does not stand in for a missing sign-in", async () => {
    const { config, secrets, models } = setup();

    config.set(["agent", "provider"], "openai");
    config.set(["agent", "auth"], AgentAuth.Subscription);
    await secrets.save(agentKeySecret("openai"), "sk-test");

    expect((await models.settings()).ready).toBe(false);
  });

  test("applies only to providers that offer it", async () => {
    const { config, secrets, models } = setup();

    config.set(["agent", "provider"], "anthropic");
    config.set(["agent", "auth"], AgentAuth.Subscription);
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
