import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { McpServerState, McpTransportKind } from "@solyx/agent/mcp-config";
import type { SetupArea } from "@solyx/agent/setup";
import { FinMindPlan } from "@solyx/fundamentals/finmind";
import { FUGLE_PLANS, FuglePlan } from "@solyx/market-data/fugle";

import {
  FubonFile,
  FubonSessionState,
  MarketDataSource,
  Secret,
  mcpSecretKey,
} from "#shared/ipc/settings.ts";
import type { MarketDataStatus } from "#shared/ipc/settings.ts";

import { createAgentModels } from "../src/main/modules/agent/agent-models.ts";
import { createAgentSetup } from "../src/main/modules/agent/agent-setup.ts";
import type { McpServers } from "../src/main/modules/agent/mcp-servers.ts";
import { createDecisions } from "../src/main/modules/decisions/decisions.ts";
import { createEmbeddings } from "../src/main/modules/embeddings/embeddings.ts";
import { createAppearance } from "../src/main/modules/settings/appearance.ts";
import { createConfigFile } from "../src/main/modules/settings/config-file.ts";
import { createSecretStore } from "../src/main/modules/settings/secret-store.ts";
import { createWebSearch } from "../src/main/modules/web-search/web-search.ts";

import { fakeCipher } from "./fake-cipher.ts";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "solyx-setup-"));
});

afterEach(() => rm(home, { recursive: true, force: true }));

function marketStatus(
  source: MarketDataSource,
  ready: boolean
): MarketDataStatus {
  return {
    markets: { TW: { source, ready }, US: null },
    fugle: { plan: FuglePlan.Basic, plans: Object.values(FUGLE_PLANS) },
    fubon: {
      plan: FUGLE_PLANS[FuglePlan.Basic],
      files: {
        [FubonFile.Sdk]: join(home, "fubon-sdk"),
        [FubonFile.Certificate]: null,
      },
      session: { state: FubonSessionState.SignedOut },
    },
  };
}

function setup() {
  const configDir = join(home, ".solyx");
  const config = createConfigFile(join(configDir, "config.json"));

  config.create();

  const secrets = createSecretStore(
    join(home, "data", "secrets.json"),
    fakeCipher().cipher
  );

  const marketData = {
    status: vi.fn(async () => marketStatus(MarketDataSource.Fugle, false)),
  };

  const mcp = {
    file: join(configDir, "mcp.json"),
    status: vi.fn<McpServers["status"]>(async () => ({
      error: undefined,
      servers: [],
    })),
  };

  const models = createAgentModels({
    config,
    secrets,
    getDeviceId: () => "00000000-0000-4000-8000-000000000000",
    openExternal: vi.fn(),
  });

  const port = createAgentSetup({
    config,
    secrets,
    appearance: createAppearance({ config, onChange: vi.fn() }),
    marketData,
    models,
    webSearch: createWebSearch({ config, secrets }),
    decisions: createDecisions({ config, secrets }),
    embeddings: createEmbeddings({ config, secrets }),
    mcp,
    skills: async () => ({ skills: [], warnings: [] }),
    instructions: async () => undefined,
    memory: { list: () => [] },
    shellOn: () => false,
    version: "0.9.0",
    home,
    files: {
      config: config.file,
      skills: join(configDir, "skills"),
      instructions: join(configDir, "AGENTS.md"),
    },
  });

  return { port, config, secrets, models, marketData, mcp };
}

const area = (areas: SetupArea[], name: string) => {
  const found = areas.find((each) => each.name === name);

  if (!found) throw new Error(`No area named ${name}`);

  return found;
};

const setting = (found: SetupArea, name: string) =>
  found.settings.find((each) => each.name === name);

test("a fresh install reads as missing what first-time setup asks for, each on its tab", async () => {
  const { port } = setup();

  const areas = await port.read();

  expect(areas.map((each) => [each.name, each.link])).toEqual([
    ["General", "#/settings?section=general"],
    ["Market data", "#/settings?section=market-data"],
    ["Agent models", "#/settings?section=agent"],
    ["Web search", "#/settings?section=agent"],
    ["News", "#/settings?section=agent"],
    ["Decisions model", "#/settings?section=agent"],
    ["Embeddings", "#/settings?section=agent"],
    ["Skills", "#/settings?section=skills"],
    ["Memory", "#/settings?section=memory"],
    ["MCP servers", "#/settings?section=mcp"],
    ["About", "#/settings?section=about"],
  ]);

  expect(area(areas, "Market data").missing).toEqual([
    "Taiwan's charts, quotes and news have no source: fugle still needs a Fugle API key.",
  ]);
  expect(area(areas, "Agent models").missing).toEqual([
    "No provider switched on has a key saved or a subscription signed in, so the agent cannot run.",
  ]);
  expect(area(areas, "Web search").missing).toHaveLength(1);
  expect(area(areas, "Decisions model").missing).toHaveLength(1);
  expect(area(areas, "General").missing).toEqual([]);
});

test("a config entry carries the description its JSON Schema gives", async () => {
  const { port } = setup();

  const areas = await port.read();

  expect(setting(area(areas, "Market data"), "marketData.TW")).toEqual({
    name: "marketData.TW",
    value: MarketDataSource.Fugle,
    description: "Where Taiwan charts come from.",
    accepts: "one of fugle, fubon",
  });
  expect(setting(area(areas, "Agent models"), "agent.thinking")).toMatchObject({
    description: "How long the model thinks before it answers.",
  });
});

test("a saved key reads only as saved, never as its value", async () => {
  const { port, secrets, marketData } = setup();

  await secrets.save(Secret.FugleApiKey, "fugle-key-value");
  await secrets.save(Secret.FinMindToken, "finmind-token-value");
  marketData.status.mockResolvedValue(
    marketStatus(MarketDataSource.Fugle, true)
  );

  const areas = await port.read();
  const text = JSON.stringify(areas);

  expect(text).not.toContain("fugle-key-value");
  expect(text).not.toContain("finmind-token-value");
  expect(setting(area(areas, "Market data"), "Fugle API key")?.value).toBe(
    "saved"
  );
  expect(area(areas, "Market data").missing).toEqual([]);
  expect(
    setting(area(areas, "Market data"), "providers.finmind.plan")?.value
  ).toBe(FinMindPlan.Free);
});

test("Fubon names what it still needs and a failed sign-in that waits for the user", async () => {
  const { port, secrets, marketData } = setup();

  await secrets.save(Secret.FubonApiKey, "fubon-key");
  marketData.status.mockResolvedValue({
    ...marketStatus(MarketDataSource.Fubon, false),
    fubon: {
      ...marketStatus(MarketDataSource.Fubon, false).fubon,
      session: { state: FubonSessionState.Failed, message: "wrong password" },
    },
  });

  const { missing } = area(await port.read(), "Market data");

  expect(missing[0]).toBe(
    "Taiwan's charts, quotes and news have no source: fubon still needs the certificate, the ID number."
  );
  expect(missing[1]).toMatch(/^Fubon's sign-in failed: wrong password\./);
});

test("an MCP server says which secrets it waits for and why it failed", async () => {
  const { port, secrets, mcp } = setup();

  await secrets.save(mcpSecretKey("GITHUB_TOKEN"), "token");
  mcp.status.mockResolvedValue({
    error: undefined,
    servers: [
      {
        name: "github",
        kind: McpTransportKind.Stdio,
        target: "github-mcp",
        state: McpServerState.Failed,
        error: "exited with code 1",
        tools: [],
        secrets: ["GITHUB_TOKEN", "GITHUB_ORG"],
        signedIn: false,
      },
    ],
  });

  const found = area(await port.read(), "MCP servers");

  expect(found.missing).toEqual([
    "github needs the secrets GITHUB_ORG saved.",
    "github failed to connect: exited with code 1",
  ]);
  expect(found.settings).toEqual([
    { name: "github", value: "failed, 0 tools" },
  ]);
});

test("a setting the agent may change says what it takes; one only the user changes does not", async () => {
  const { port } = setup();

  const areas = await port.read();

  expect(setting(area(areas, "Agent models"), "agent.thinking")?.accepts).toBe(
    "one of off, low, medium, high"
  );
  expect(
    setting(area(areas, "Embeddings"), "embeddings.enabled")
  ).toMatchObject({
    value: "false",
    accepts: "one of true, false",
  });
  expect(
    setting(area(areas, "Memory"), "agent.memory")?.accepts
  ).toBeUndefined();
  expect(
    setting(area(areas, "Skills"), "agent.shell")?.accepts
  ).toBeUndefined();
  expect(
    setting(area(areas, "Market data"), "Fugle API key")?.accepts
  ).toBeUndefined();
});

test("a change goes through the writers the settings page uses", async () => {
  const { port, config, models } = setup();

  await port.change({ setting: "agent.thinking", value: "high" });
  await port.change({ setting: "agent.decisionMode", value: "magi" });
  await port.change({ setting: "appearance.theme", value: "dark" });
  await port.change({ setting: "appearance.palette.dark", value: "sepia" });
  await port.change({ setting: "embeddings.enabled", value: "true" });
  await port.change({ setting: "news.collectEveryHours", value: "24" });

  await models.saveKey("anthropic", "anthropic-key");
  await port.change({ setting: "agent.provider", value: "anthropic" });

  const saved = config.read();

  expect(saved.agent).toMatchObject({
    thinking: "high",
    decisionMode: "magi",
    provider: "anthropic",
  });
  expect(saved.appearance.theme).toBe("dark");
  expect(saved.appearance.palette.dark).toBe("sepia");
  expect(saved.embeddings.enabled).toBe(true);
  expect(saved.news.collectEveryHours).toBe(24);
});

test("a change the agent may not make is refused with what the setting takes, and nothing is saved", async () => {
  const { port, config } = setup();
  const before = JSON.stringify(config.read());

  await expect(
    port.check({ setting: "agent.shell", value: "true" })
  ).rejects.toThrow("agent.shell is not a setting change_setting takes");
  await expect(
    port.check({ setting: "constructor", value: "x" })
  ).rejects.toThrow("constructor is not a setting change_setting takes");
  await expect(
    port.change({ setting: "agent.thinking", value: "max" })
  ).rejects.toThrow(
    'agent.thinking takes one of off, low, medium, high, not "max".'
  );
  await expect(
    port.check({ setting: "news.collectEveryHours", value: "1e3" })
  ).rejects.toThrow("news.collectEveryHours takes a whole number of hours");
  // A provider without a key saved could not run, so it cannot be the default.
  await expect(
    port.check({ setting: "agent.provider", value: "anthropic" })
  ).rejects.toThrow("agent.provider takes one of");

  expect(JSON.stringify(config.read())).toBe(before);
});
