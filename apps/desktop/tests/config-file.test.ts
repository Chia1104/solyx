import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, test } from "vite-plus/test";

import { AgentAuth, AgentThinking } from "@solyx/agent/providers";
import {
  CLOUDFLARE_BASE_URL,
  CLOUDFLARE_DEFAULT_MODEL,
} from "@solyx/decisions/cloudflare";
import { DecisionsProvider } from "@solyx/decisions/provider";
import {
  TYPESAFE_BASE_URL,
  TYPESAFE_DEFAULT_MODEL,
} from "@solyx/decisions/typesafe";
import { FuglePlan } from "@solyx/market-data/fugle";
import { WebSearchProvider } from "@solyx/web-search/provider";

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
  file = join(directory, ".solyx", "config.json");
});

afterEach(() => rm(directory, { recursive: true, force: true }));

const fuglePlan = (config: ReturnType<typeof createConfigFile>) =>
  config.read().providers.fugle.plan;

test("a missing file reads as the defaults, which a new file's template holds beside its schema", async () => {
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
      provider: "anthropic",
      thinking: AgentThinking.Medium,
      auth: AgentAuth.ApiKey,
      endpoints: {},
      sharedSkills: [],
      shell: false,
      decisionMode: "single",
      memory: true,
      mcpTools: {},
    },
    news: { collectEveryHours: NEWS_COLLECTION_DEFAULT_HOURS },
    webSearch: { provider: WebSearchProvider.Firecrawl },
    decisions: {
      provider: DecisionsProvider.TypeSafe,
      typesafe: {},
      cloudflare: {},
    },
  });

  config.create();

  // The template names its schema, and the decisions model and endpoint.
  expect(config.read()).toEqual({
    $schema: "./config.schema.json",
    ...defaults,
    decisions: {
      provider: DecisionsProvider.TypeSafe,
      typesafe: { model: TYPESAFE_DEFAULT_MODEL, baseURL: TYPESAFE_BASE_URL },
      cloudflare: {
        model: CLOUDFLARE_DEFAULT_MODEL,
        baseURL: CLOUDFLARE_BASE_URL,
      },
    },
  });
  expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({
    $schema: "./config.schema.json",
  });
  expect(
    JSON.parse(
      await readFile(join(directory, ".solyx", "config.schema.json"), "utf8")
    )
  ).toMatchObject({
    properties: {
      agent: {
        properties: {
          thinking: {
            default: AgentThinking.Medium,
            enum: Object.values(AgentThinking),
          },
        },
      },
    },
  });

  if (process.platform !== "win32") {
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  }
});

test("saving a plan keeps the entries around it, the app's and others alike", async () => {
  const config = createConfigFile(file);

  config.create();
  await writeFile(
    file,
    JSON.stringify({
      $schema: "./config.schema.json",
      appearance: { theme: "dark" },
      providers: { fugle: { plan: "developer", region: "tw" } },
    })
  );

  expect(fuglePlan(config)).toBe("developer");

  config.set(["providers", "fugle", "plan"], "advanced");
  config.set(["providers", "fubon", "sdk"], "/sdk/package");

  expect(fuglePlan(config)).toBe("advanced");
  expect(config.read().providers.fubon.sdk).toBe("/sdk/package");
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
    $schema: "./config.schema.json",
    appearance: { theme: "dark" },
    providers: {
      fugle: { plan: "advanced", region: "tw" },
      fubon: { sdk: "/sdk/package" },
    },
  });
});

test("an update saves every entry", async () => {
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
});

test("saving beneath an entry of the wrong shape replaces it, since it reads as its default", async () => {
  const config = createConfigFile(file);

  config.create();
  await writeFile(file, '{ "providers": { "fugle": "developer" } }');

  config.set(["providers", "fugle", "plan"], "advanced");
  // Nothing stands beneath a palette that is not an object, so removing a colour leaves it.
  config.set(["appearance", "palettes", "dusk", "light", "accent"], undefined);

  expect(fuglePlan(config)).toBe("advanced");
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
    providers: { fugle: { plan: "advanced" } },
  });
});

test("a file with syntax errors reads as defaults and is never overwritten", async () => {
  const config = createConfigFile(file);

  // Comments are not JSON.
  const broken =
    '{ "providers": { "fugle": { "plan": "developer" } } } // mine';

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
      agent: {
        provider: "openai",
        thinking: "forever",
        sharedSkills: "all",
        endpoints: {
          anthropic: "file:///etc/hosts",
          google: "https://gateway.example/v1beta",
        },
      },
      decisions: {
        provider: "nobody",
        typesafe: { model: " ", baseURL: "file:///etc/hosts" },
        cloudflare: "none",
      },
    })
  );

  expect(config.read()).toMatchObject({
    marketData: { TW: MarketDataSource.Fugle },
    providers: {
      fugle: { plan: FuglePlan.Basic },
      fubon: { sdk: "/sdk", certificate: undefined },
    },
    agent: {
      provider: "openai",
      thinking: AgentThinking.Medium,
      sharedSkills: [],
      endpoints: {
        anthropic: undefined,
        google: "https://gateway.example/v1beta",
      },
    },
    decisions: {
      provider: DecisionsProvider.TypeSafe,
      typesafe: { model: undefined, baseURL: undefined },
      cloudflare: {},
    },
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
