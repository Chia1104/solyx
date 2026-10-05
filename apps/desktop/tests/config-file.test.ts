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
import {
  TYPESAFE_BASE_URL,
  TYPESAFE_DEFAULT_MODEL,
} from "@solyx/decisions/typesafe";
import { FuglePlan } from "@solyx/market-data/fugle";

import {
  MarketDataSource,
  NEWS_COLLECTION_DEFAULT_HOURS,
  PriceColors,
  Theme,
} from "#shared/ipc/settings.ts";
import { Palette } from "#shared/palette.ts";

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
    appearance: {
      theme: Theme.System,
      palette: { light: Palette.Blueprint, dark: Palette.Blueprint },
      palettes: {},
      priceColors: PriceColors.Market,
    },
    marketData: { TW: MarketDataSource.Fugle },
    providers: { fugle: { plan: FuglePlan.Basic }, fubon: {} },
    agent: {
      providers: [],
      provider: AgentProvider.Anthropic,
      thinking: AgentThinking.Medium,
      auth: AgentAuth.ApiKey,
      sharedSkills: [],
      shell: false,
      mcpTools: {},
    },
    news: { collectEveryHours: NEWS_COLLECTION_DEFAULT_HOURS },
    decisions: {},
  });

  config.create();

  // The template names the default models and endpoint, and its empty paths read as not chosen.
  expect(config.read()).toEqual({
    ...defaults,
    agent: {
      ...defaults.agent,
      model: DEFAULT_MODEL[defaults.agent.provider],
    },
    decisions: { model: TYPESAFE_DEFAULT_MODEL, baseURL: TYPESAFE_BASE_URL },
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

test("saving beneath an entry of the wrong shape replaces it, since it reads as its default", async () => {
  const config = createConfigFile(file);

  config.create();
  await writeFile(file, '{ "providers": { "fugle": "developer" } } // kept');

  config.set(["providers", "fugle", "plan"], "advanced");

  expect(fuglePlan(config)).toBe("advanced");
  expect(await readFile(file, "utf8")).toContain("// kept");
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

test("the app's own saves are reported as they are written, once even while watched", async () => {
  const config = createConfigFile(file);
  const heard: string[] = [];

  config.create();
  config.onChange(() => heard.push(fuglePlan(config)));

  const stop = config.watch();

  config.set(["providers", "fugle", "plan"], FuglePlan.Developer);

  expect(heard).toEqual([FuglePlan.Developer]);

  // Longer than the watcher waits before it reports.
  await new Promise((resolve) => setTimeout(resolve, 400));
  stop();

  expect(heard).toEqual([FuglePlan.Developer]);
});

test("changes made outside the app are reported while watched", async () => {
  const config = createConfigFile(file);

  config.create();

  const stop = config.watch();

  const changed = new Promise<void>((resolve) => {
    const stopListening = config.onChange(() => {
      stopListening();
      resolve();
    });
  });

  await writeFile(file, '{ "providers": { "fugle": { "plan": "advanced" } } }');
  await changed;
  stop();

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
      decisions: { model: " ", baseURL: "file:///etc/hosts" },
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
    decisions: { model: undefined, baseURL: undefined },
  });
});

test("the appearance falls back entry by entry until values the app knows are saved", async () => {
  const config = createConfigFile(file);

  const defaults = {
    theme: Theme.System,
    palette: { light: Palette.Blueprint, dark: Palette.Blueprint },
    palettes: {},
    priceColors: PriceColors.Market,
  };

  config.create();

  expect(config.read().appearance).toEqual(defaults);

  await writeFile(
    file,
    JSON.stringify({
      appearance: {
        theme: "sepia",
        palette: { light: "iris", dark: "neon" },
        priceColors: "blue-up",
      },
      marketData: { TW: "fubon" },
    })
  );

  expect(config.read().appearance).toEqual({
    ...defaults,
    palette: { light: Palette.Iris, dark: Palette.Blueprint },
  });

  config.set(["appearance", "theme"], "dark");
  config.set(["appearance", "palette", "dark"], "lagoon");
  config.set(["appearance", "priceColors"], "red-up");

  expect(config.read().appearance).toEqual({
    theme: Theme.Dark,
    palette: { light: Palette.Iris, dark: Palette.Lagoon },
    palettes: {},
    priceColors: PriceColors.RedUp,
  });
  expect(config.read().marketData.TW).toBe("fubon");
});

test("custom palettes keep what parses, and a palette is shown only while it exists", async () => {
  const config = createConfigFile(file);

  config.create();
  await writeFile(
    file,
    JSON.stringify({
      appearance: {
        palette: { light: "dusk", dark: "missing" },
        palettes: {
          dusk: {
            name: "Dusk",
            extends: "iris",
            light: { accent: "#AA3366", muted: "teal", glow: "#ffffff" },
            dark: "none",
          },
          plain: { extends: "neon" },
          broken: "#ffffff",
          sepia: { name: "Mine", extends: "graphite" },
        },
      },
    })
  );

  expect(config.read().appearance).toMatchObject({
    palette: { light: "dusk", dark: Palette.Blueprint },
    palettes: {
      dusk: {
        name: "Dusk",
        extends: Palette.Iris,
        light: { accent: "#aa3366" },
        dark: {},
      },
      plain: { extends: Palette.Blueprint, light: {}, dark: {} },
    },
  });
  expect(Object.keys(config.read().appearance.palettes)).toEqual([
    "dusk",
    "plain",
  ]);

  config.set(
    ["appearance", "palettes", "dusk", "dark", "background"],
    "#101010"
  );
  config.set(["appearance", "palettes", "dusk", "light", "accent"], undefined);

  expect(config.read().appearance.palettes.dusk).toMatchObject({
    light: {},
    dark: { background: "#101010" },
  });

  config.set(["appearance", "palettes", "dusk"], undefined);

  expect(config.read().appearance.palette.light).toBe(Palette.Blueprint);
});
