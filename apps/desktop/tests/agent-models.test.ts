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

import {
  AgentAuth,
  AgentProvider,
  AgentThinking,
} from "@solyx/agent/providers";

import { Locale, Secret } from "#shared/ipc/settings.ts";

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

    config.set(["agent", "provider"], AgentProvider.Anthropic);

    const offered = async () =>
      new Set((await models.settings()).models.map((model) => model.provider));

    expect(await offered()).toEqual(new Set([AgentProvider.Anthropic]));
    expect(await providerOf(models, AgentProvider.Google)).toMatchObject({
      enabled: false,
    });

    config.set(["agent", "providers"], [AgentProvider.Google]);

    expect(await offered()).toEqual(
      new Set([AgentProvider.Anthropic, AgentProvider.Google])
    );
  });

  test("a conversation runs on its own model, or on the default where it picked none", async () => {
    const { config, secrets, models } = setup();

    config.set(["agent", "provider"], AgentProvider.Anthropic);
    config.set(["agent", "providers"], [AgentProvider.OpenAI]);
    await secrets.save(Secret.AnthropicApiKey, "sk-ant-test");
    await secrets.save(Secret.OpenAIApiKey, "sk-test");

    expect((await models.choice()).model.provider).toBe(
      AgentProvider.Anthropic
    );

    const picked = await models.choice({
      model: { provider: AgentProvider.OpenAI, id: "gpt-6.1-sol" },
      thinking: AgentThinking.High,
    });

    expect(picked).toMatchObject({
      model: { provider: AgentProvider.OpenAI, id: "gpt-6.1-sol" },
      thinking: AgentThinking.High,
    });
  });

  test("a model of a provider switched off, or without its key, does not run", async () => {
    const { config, secrets, models } = setup();

    const pick = {
      model: { provider: AgentProvider.Google, id: "gemini-3.1-pro-preview" },
      thinking: null,
    };

    config.set(["agent", "provider"], AgentProvider.Anthropic);
    await secrets.save(Secret.AnthropicApiKey, "sk-ant-test");

    await expect(models.choice(pick)).rejects.toThrow("switched off");

    config.set(["agent", "providers"], [AgentProvider.Google]);

    await expect(models.choice(pick)).rejects.toThrow("Save an API key");
  });
});

describe("paying by subscription", () => {
  test("runs on the stored sign-in, with no key of its own", async () => {
    const { config, secrets, models } = setup();

    config.set(["agent", "provider"], AgentProvider.OpenAI);
    config.set(["agent", "model"], "gpt-6.1-sol");
    config.set(["agent", "auth"], AgentAuth.Subscription);

    expect(await models.settings()).toMatchObject({ ready: false });
    expect(await providerOf(models, AgentProvider.OpenAI)).toMatchObject({
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
    expect(await providerOf(models, AgentProvider.OpenAI)).toMatchObject({
      subscription: { signedIn: true },
      usable: true,
    });

    expect((await models.choice()).model.id).toBe("gpt-6.1-sol");
  });

  test("keeps OpenAI's own endpoint, which an API key would leave for the one set", async () => {
    const { config, secrets, models } = setup();
    const gateway = "https://gateway.example/v1";

    config.set(["agent", "provider"], AgentProvider.OpenAI);
    config.set(["agent", "endpoints", AgentProvider.OpenAI], gateway);
    await secrets.save(Secret.OpenAIApiKey, "sk-test");

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
      models.defaultEndpoint(AgentProvider.OpenAI)
    );
  });

  test("a saved key does not stand in for a missing sign-in", async () => {
    const { config, secrets, models } = setup();

    config.set(["agent", "provider"], AgentProvider.OpenAI);
    config.set(["agent", "auth"], AgentAuth.Subscription);
    await secrets.save(Secret.OpenAIApiKey, "sk-test");

    expect((await models.settings()).ready).toBe(false);
  });

  test("applies only to providers that offer it", async () => {
    const { config, secrets, models } = setup();

    config.set(["agent", "provider"], AgentProvider.Anthropic);
    config.set(["agent", "auth"], AgentAuth.Subscription);
    await secrets.save(Secret.AnthropicApiKey, "sk-ant-test");

    expect(await models.settings()).toMatchObject({ ready: true });
    expect(await providerOf(models, AgentProvider.Anthropic)).toMatchObject({
      auth: AgentAuth.ApiKey,
      subscription: null,
      usable: true,
    });
    await expect(models.choice()).resolves.toBeDefined();
    await expect(
      models.signIn(AgentProvider.Anthropic, Locale.EnUS)
    ).rejects.toThrow("no subscription sign-in");
  });
});
