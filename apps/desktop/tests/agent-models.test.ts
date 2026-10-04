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

import { AgentAuth, AgentProvider } from "@solyx/agent/providers";

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

describe("paying by subscription", () => {
  test("runs on the stored sign-in, with no key of its own", async () => {
    const { config, secrets, models } = setup();

    config.set(["agent", "provider"], AgentProvider.OpenAI);
    config.set(["agent", "model"], "gpt-6.1-sol");
    config.set(["agent", "auth"], AgentAuth.Subscription);

    expect(await models.settings()).toMatchObject({
      auth: AgentAuth.Subscription,
      subscription: { signedIn: false },
      ready: false,
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

    expect(await models.settings()).toMatchObject({
      subscription: { signedIn: true },
      ready: true,
    });

    expect((await models.choice()).model.id).toBe("gpt-6.1-sol");
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

    expect(await models.settings()).toMatchObject({
      auth: AgentAuth.ApiKey,
      subscription: null,
      ready: true,
    });
    await expect(models.choice()).resolves.toBeDefined();
    await expect(models.signIn(Locale.EnUS)).rejects.toThrow(
      "no subscription sign-in"
    );
  });
});
