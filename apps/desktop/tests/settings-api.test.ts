import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import {
  McpServerState,
  McpToolPolicy,
  McpTransportKind,
  mcpToolKey,
} from "@solyx/agent/mcp-config";
import { DEFAULT_MODEL } from "@solyx/agent/models";
import type { AgentProvider } from "@solyx/agent/providers";
import { WebSearchProvider } from "@solyx/web-search/provider";

import {
  AppLocation,
  SecretState,
  agentKeySecret,
  mcpSecretKey,
  webSearchKeySecret,
} from "#shared/ipc/settings.ts";

import { createAgentModels } from "../src/main/modules/agent/agent-models.ts";
import type { McpServers } from "../src/main/modules/agent/mcp-servers.ts";
import { createAppearance } from "../src/main/modules/settings/appearance.ts";
import { createConfigFile } from "../src/main/modules/settings/config-file.ts";
import { createSecretStore } from "../src/main/modules/settings/secret-store.ts";
import { createSettingsApi } from "../src/main/modules/settings/settings-api.ts";
import { createWebSearch } from "../src/main/modules/web-search/web-search.ts";

import { fakeCipher } from "./fake-cipher.ts";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "solyx-settings-"));
});

afterEach(() => rm(home, { recursive: true, force: true }));

function setup() {
  const configDir = join(home, ".solyx");
  const config = createConfigFile(join(configDir, "config.json"));

  config.create();

  const secrets = createSecretStore(
    join(home, "data", "secrets.json"),
    fakeCipher().cipher
  );

  const mcp = {
    file: join(configDir, "mcp.json"),
    policies: () => ({
      [mcpToolKey("broker", "quote")]: McpToolPolicy.Auto,
      [mcpToolKey("broker", "order")]: McpToolPolicy.Auto,
    }),
    status: vi.fn<McpServers["status"]>(async () => ({
      error: undefined,
      servers: [],
    })),
    reconnect: vi.fn<McpServers["reconnect"]>(),
    signIn: vi.fn<McpServers["signIn"]>(),
    cancelSignIn: vi.fn<McpServers["cancelSignIn"]>(),
    signOut: vi.fn<McpServers["signOut"]>(),
    create: vi.fn<McpServers["create"]>(async () => undefined),
  };

  const shell = {
    chooseFubonFile: vi.fn(async () => null),
    showItemInFolder: vi.fn<(path: string) => void>(),
    about: () => ({
      name: "Solyx Dev",
      version: "0.0.0",
      packaged: false,
      electron: "40.0.0",
      chromium: "140.0.0",
      node: "24.0.0",
      os: "macOS 26.0 (arm64)",
    }),
  };

  const skillFolders = {
    solyx: join(configDir, "skills"),
    shared: join(home, ".agents", "skills"),
  };

  const api = createSettingsApi({
    config,
    secrets,
    appearance: createAppearance({ config, onChange: vi.fn() }),
    marketData: {
      status: vi.fn(),
      signInFubon: vi.fn(),
    },
    agent: {
      models: createAgentModels({
        config,
        secrets,
        getDeviceId: () => "00000000-0000-4000-8000-000000000000",
        openExternal: vi.fn(),
      }),
      skills: async () => ({ skills: [], warnings: [] }),
      instructions: async () => undefined,
    },
    mcp,
    decisions: { settings: vi.fn() },
    webSearch: createWebSearch({ config, secrets }),
    home,
    locations: {
      [AppLocation.Data]: join(home, "data"),
      [AppLocation.Config]: config.file,
      [AppLocation.Skills]: skillFolders.solyx,
      [AppLocation.Mcp]: mcp.file,
    },
    skillFolders,
    instructionsFile: join(configDir, "AGENTS.md"),
    shell,
  });

  return { api, config, secrets, mcp, shell };
}

test("a web search vendor's key is saved under its id, and the vendor in use is a setting", async () => {
  const { api, config, secrets } = setup();

  expect(await api.webSearch()).toEqual({
    provider: WebSearchProvider.Firecrawl,
    keys: {
      [WebSearchProvider.Firecrawl]: SecretState.Missing,
      [WebSearchProvider.Exa]: SecretState.Missing,
    },
  });

  await api.saveWebSearchKey(WebSearchProvider.Exa, "exa-key");
  await api.setWebSearchProvider(WebSearchProvider.Exa);

  expect(await secrets.get(webSearchKeySecret(WebSearchProvider.Exa))).toBe(
    "exa-key"
  );
  expect(config.read().webSearch.provider).toBe(WebSearchProvider.Exa);
  expect(await api.webSearch()).toMatchObject({
    provider: WebSearchProvider.Exa,
    keys: { [WebSearchProvider.Exa]: SecretState.Saved },
  });

  await api.deleteWebSearchKey(WebSearchProvider.Exa);

  expect(
    await secrets.get(webSearchKeySecret(WebSearchProvider.Exa))
  ).toBeUndefined();
});

test("switching the agent's provider starts from its default model, in one save", async () => {
  const { api, config } = setup();
  const saves = vi.fn();

  config.onChange(saves);
  await api.setAgentModel("claude-something-else");
  saves.mockClear();
  await api.setAgentProvider("openai");

  expect(saves).toHaveBeenCalledOnce();
  expect(config.read().agent).toMatchObject({
    provider: "openai",
    model: DEFAULT_MODEL.openai,
  });
  expect(await api.agent()).toMatchObject({
    provider: "openai",
    model: DEFAULT_MODEL.openai,
  });
});

test("a provider is switched on once, and off again", async () => {
  const { api, config } = setup();

  await api.setAgentProviderEnabled("google", true);
  await api.setAgentProviderEnabled("google", true);

  expect(config.read().agent.providers).toEqual(["google"]);

  await api.setAgentProviderEnabled("google", false);

  expect(config.read().agent.providers).toEqual([]);
});

test("a provider's endpoint is set and goes back to its own, except for one whose models use several", async () => {
  const { api, config } = setup();
  const gateway = "https://gateway.example/v1";

  const endpointOf = async (provider: AgentProvider) =>
    (await api.agent()).providers.find((each) => each.provider === provider)
      ?.endpoint;

  const own = (await endpointOf("openai"))?.default;

  await api.setAgentEndpoint("openai", gateway);

  expect(await endpointOf("openai")).toEqual({
    url: gateway,
    default: own,
  });

  await api.setAgentEndpoint("openai", null);

  expect(config.read().agent.endpoints).toEqual({});
  expect(await endpointOf("openai")).toEqual({
    url: own,
    default: own,
  });

  expect(await endpointOf("openrouter")).toBeNull();
  await expect(api.setAgentEndpoint("openrouter", gateway)).rejects.toThrow(
    "several endpoints"
  );
});

test("a provider's key is saved under its id, and a provider the app does not offer is refused", async () => {
  const { api, secrets } = setup();

  await api.saveAgentKey("deepseek", "sk-deepseek");

  expect(await secrets.get(agentKeySecret("deepseek"))).toBe("sk-deepseek");

  await api.deleteAgentKey("deepseek");

  expect(await secrets.get(agentKeySecret("deepseek"))).toBeUndefined();

  await expect(api.saveAgentKey("amazon-bedrock", "key")).rejects.toThrow(
    "not a provider the app offers"
  );
  await expect(
    api.setAgentProviderEnabled("amazon-bedrock", true)
  ).rejects.toThrow("not a provider the app offers");
  await expect(api.setAgentProvider("nowhere")).rejects.toThrow(
    "not a provider the app offers"
  );
});

test("a shared skill is switched on once, and off again", async () => {
  const { api, config } = setup();

  await api.setSharedSkill("breakout-watch", true);
  await api.setSharedSkill("breakout-watch", true);

  expect(config.read().agent.sharedSkills).toEqual(["breakout-watch"]);

  await api.setSharedSkill("breakout-watch", false);

  expect(config.read().agent.sharedSkills).toEqual([]);
});

test("the shell is off until the user switches it on", async () => {
  const { api, config } = setup();

  expect((await api.agentSkills()).shell).toBe(false);

  await api.setAgentShell(true);

  expect(config.read().agent.shell).toBe(true);
  expect((await api.agentSkills()).shell).toBe(true);
});

test("MCP servers show each tool under the policy in force, which secrets are saved, and paths from home", async () => {
  const { api, secrets, mcp } = setup();

  mcp.status.mockResolvedValue({
    error: undefined,
    servers: [
      {
        name: "broker",
        kind: McpTransportKind.Stdio,
        target: join(home, "bin", "broker-mcp"),
        state: McpServerState.Connected,
        tools: [
          { name: "quote", readOnly: true },
          { name: "order", readOnly: false },
          { name: "history", readOnly: true },
        ],
        secrets: ["BROKER_TOKEN", "BROKER_SECRET"],
        signedIn: false,
      },
    ],
  });
  await secrets.save(mcpSecretKey("BROKER_TOKEN"), "token");

  expect(await api.mcp()).toEqual({
    path: "~/.solyx/mcp.json",
    error: undefined,
    servers: [
      {
        name: "broker",
        kind: McpTransportKind.Stdio,
        target: "~/bin/broker-mcp",
        state: McpServerState.Connected,
        error: undefined,
        // Only a tool its server marks read-only runs without asking.
        tools: [
          { name: "quote", readOnly: true, policy: McpToolPolicy.Auto },
          { name: "order", readOnly: false, policy: McpToolPolicy.Ask },
          { name: "history", readOnly: true, policy: McpToolPolicy.Ask },
        ],
        secrets: [
          { name: "BROKER_TOKEN", saved: true },
          { name: "BROKER_SECRET", saved: false },
        ],
        signedIn: false,
      },
    ],
  });
});

test("a changed MCP secret reconnects its server", async () => {
  const { api, secrets, mcp } = setup();

  await api.saveMcpSecret("broker", "BROKER_TOKEN", "token");

  expect(await secrets.get(mcpSecretKey("BROKER_TOKEN"))).toBe("token");
  expect(mcp.reconnect).toHaveBeenCalledWith("broker");
});

test("showing the skills folder creates it first, and mcp.json is written before it is shown", async () => {
  const { api, mcp, shell } = setup();

  await api.reveal(AppLocation.Skills);

  expect((await stat(join(home, ".solyx", "skills"))).isDirectory()).toBe(true);
  expect(shell.showItemInFolder).toHaveBeenLastCalledWith(
    join(home, ".solyx", "skills")
  );

  await api.reveal(AppLocation.Mcp);

  expect(mcp.create).toHaveBeenCalledOnce();
  expect(shell.showItemInFolder).toHaveBeenLastCalledWith(mcp.file);
});

test("About shows paths from home", async () => {
  const { api } = setup();

  expect((await api.about()).locations).toEqual({
    [AppLocation.Data]: "~/data",
    [AppLocation.Config]: "~/.solyx/config.json",
    [AppLocation.Skills]: "~/.solyx/skills",
    [AppLocation.Mcp]: "~/.solyx/mcp.json",
  });
});
