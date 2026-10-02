import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, test } from "vite-plus/test";

import {
  AgentAuth,
  AgentProvider,
  AgentThinking,
  DEFAULT_MODEL,
} from "@solyx/agent/providers";
import { FuglePlan } from "@solyx/market-data/fugle";

import { MarketDataSource, PriceColors, Theme } from "#shared/ipc/settings.ts";

import { createConfigFile } from "../src/main/modules/settings/config-file.ts";

let directory: string;

let file: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-config-"));
  file = join(directory, ".solyx", "config.jsonc");
});

afterEach(() => rm(directory, { recursive: true, force: true }));

const fuglePlan = (config: ReturnType<typeof createConfigFile>) =>
  config.read().providers.fugle.plan;

test("a missing file reads as the defaults, which a new file's commented template holds", async () => {
  const config = createConfigFile(file);
  const defaults = config.read();

  expect(defaults).toEqual({
    appearance: { theme: Theme.System, priceColors: PriceColors.Market },
    marketData: { TW: MarketDataSource.Fugle },
    providers: { fugle: { plan: FuglePlan.Basic }, fubon: {} },
    agent: {
      provider: AgentProvider.Anthropic,
      thinking: AgentThinking.Medium,
      auth: AgentAuth.ApiKey,
      sharedSkills: [],
      mcpTools: {},
    },
  });

  config.create();

  // The template names the default provider's model, and its empty paths read as not chosen.
  expect(config.read()).toEqual({
    ...defaults,
    agent: {
      ...defaults.agent,
      model: DEFAULT_MODEL[defaults.agent.provider],
    },
  });
  expect(await readFile(file, "utf8")).toMatch(/^\/\/ /);

  if (process.platform !== "win32") {
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  }
});

test("saving a plan edits it in place, keeping comments and other keys", async () => {
  const config = createConfigFile(file);

  config.create();
  await writeFile(
    file,
    [
      "// my notes",
      "{",
      '  "appearance": { "theme": "dark" }, // kept',
      '  "providers": {',
      '    "fugle": { "plan": "developer", "region": "tw" },',
      "  },",
      "}",
    ].join("\n")
  );

  expect(fuglePlan(config)).toBe("developer");

  config.set(["providers", "fugle", "plan"], "advanced");
  config.set(["providers", "fubon", "sdk"], "/sdk/package");

  const text = await readFile(file, "utf8");

  expect(fuglePlan(config)).toBe("advanced");
  expect(config.read().providers.fubon.sdk).toBe("/sdk/package");
  expect(text).toContain("// my notes");
  expect(text).toContain('"appearance": { "theme": "dark" }, // kept');
  expect(text).toContain('"region": "tw"');
});

test("an update saves every entry and keeps the file's comments", async () => {
  const config = createConfigFile(file);

  config.create();
  config.update([
    [["agent", "mcpTools", "github/create_issue"], "off"],
    [["agent", "mcpTools", "github/get_issue"], "auto"],
    [["appearance", "theme"], "dark"],
  ]);

  expect(config.read().agent.mcpTools).toEqual({
    "github/create_issue": "off",
    "github/get_issue": "auto",
  });
  expect(config.read().appearance.theme).toBe("dark");
  expect(await readFile(file, "utf8")).toMatch(/^\/\/ /);
});

test("a file with syntax errors reads as defaults and is never overwritten", async () => {
  const config = createConfigFile(file);
  const broken = '{ "providers": { "fugle": { "plan": "developer" }';

  config.create();
  await writeFile(file, broken);

  expect(fuglePlan(config)).toBe(FuglePlan.Basic);
  expect(() => config.set(["providers", "fugle", "plan"], "basic")).toThrow(
    /syntax errors/
  );
  expect(await readFile(file, "utf8")).toBe(broken);
});

test("changes made outside the app are reported", async () => {
  const config = createConfigFile(file);

  config.create();

  const changed = new Promise<void>((resolve) => {
    const stop = config.watch(() => {
      stop();
      resolve();
    });
  });

  await writeFile(file, '{ "providers": { "fugle": { "plan": "advanced" } } }');
  await changed;

  expect(fuglePlan(config)).toBe("advanced");
});

test("an entry of the wrong shape reads as its default and leaves the rest in force", async () => {
  const config = createConfigFile(file);

  config.create();
  await writeFile(
    file,
    JSON.stringify({
      marketData: { TW: 5 },
      providers: {
        fugle: "developer",
        fubon: { sdk: "/sdk", certificate: [] },
      },
      agent: { provider: "openai", thinking: "forever", sharedSkills: "all" },
    })
  );

  expect(config.read()).toMatchObject({
    marketData: { TW: MarketDataSource.Fugle },
    providers: {
      fugle: { plan: FuglePlan.Basic },
      fubon: { sdk: "/sdk", certificate: undefined },
    },
    agent: {
      provider: AgentProvider.OpenAI,
      thinking: AgentThinking.Medium,
      sharedSkills: [],
    },
  });
});

test("the appearance follows the computer and each market until values the app knows are saved", async () => {
  const config = createConfigFile(file);

  config.create();

  expect(config.read().appearance).toEqual({
    theme: Theme.System,
    priceColors: PriceColors.Market,
  });

  await writeFile(
    file,
    '{ "appearance": { "theme": "sepia", "priceColors": "blue-up" }, "marketData": { "TW": "fubon" } }'
  );

  expect(config.read().appearance).toEqual({
    theme: Theme.System,
    priceColors: PriceColors.Market,
  });

  config.set(["appearance", "theme"], "dark");
  config.set(["appearance", "priceColors"], "red-up");

  expect(config.read().appearance).toEqual({
    theme: Theme.Dark,
    priceColors: PriceColors.RedUp,
  });
  expect(config.read().marketData.TW).toBe("fubon");
});
