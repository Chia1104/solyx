import type { Context, JsonValue } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { contentText } from "@earendil-works/pi-ai";
import type {
  ToolExecutionApi,
  ToolRegistration,
} from "@earendil-works/pi-durable";
import { expect, test, vi } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import { TimePrecision } from "@solyx/core/news";
import { ThemeDesk } from "@solyx/core/theme";
import type {
  SignpostReading,
  Theme,
  ThemeItem,
  ThemeStore,
} from "@solyx/core/theme";

import { createThemeTools } from "../src/themes.ts";
import { AgentToolName } from "../src/wire.ts";

type ToolArguments = Parameters<ToolRegistration["execute"]>[0];

const AT = Date.parse("2026-10-10T09:00:00+08:00");

const OUTBREAK = {
  title: "Outbreak near the border",
  thesis: "A wider outbreak could close ports and slow shipping.",
  queries: ["outbreak border", "疫情 邊境"],
  signposts: ["Cases are confirmed in a second country."],
  listings: [
    {
      symbol: { market: Market.TW, symbol: "2603" },
      exposure: "Port closures cut its sailings.",
    },
  ],
};

function memoryStore(): ThemeStore {
  const themes = new Map<string, Theme>();
  const items = new Map<string, ThemeItem[]>();
  const readings = new Map<string, SignpostReading[]>();
  const collected = new Map<string, number>();

  return {
    list: () => [...themes.values()],
    get: (id) => themes.get(id),
    save: (theme) => void themes.set(theme.id, theme),
    remove: (id) => void themes.delete(id),
    items: (themeId, limit) =>
      (items.get(themeId) ?? []).toReversed().slice(0, limit),
    addItems: (themeId, found) =>
      void items.set(themeId, [...(items.get(themeId) ?? []), ...found]),
    readings: (themeId) => readings.get(themeId) ?? [],
    addReading: (themeId, reading) =>
      void readings.set(themeId, [...(readings.get(themeId) ?? []), reading]),
    collectedAt: (themeId) => collected.get(themeId) ?? null,
    markCollected: (themeId, at) => void collected.set(themeId, at),
  };
}

/** A call's api as pi-durable hands it to a tool, keeping the call's memo between runs. */
function callApi(): ToolExecutionApi {
  const memos = new Map<string, JsonValue>();

  // SAFETY: the theme tools read only the call's memo while what they show has no address to note.
  return {
    conversationId: 7,
    callId: "call-1",
    async memo(name: string, ...rest: [Context] | [JsonValue, Context]) {
      if (rest.length === 2 && !memos.has(name)) memos.set(name, rest[0]);

      return memos.get(name);
    },
  } as ToolExecutionApi;
}

function setup() {
  const store = memoryStore();

  const desk = new ThemeDesk({
    store,
    auditor: async () => ({
      audit: async () => ({ model: "jev", supported: 0.9 }),
    }),
    now: () => AT,
  });

  const asked = vi.fn();
  const api = callApi();

  const { tools = [] } = createThemeTools({ desk }).extension((tool) => ({
    ...tool,
    async execute(params, toolApi, context) {
      asked(params);

      return tool.execute(params, toolApi, context);
    },
  }));

  async function run(name: AgentToolName, params: ToolArguments) {
    const tool = tools.find((candidate) => candidate.name === name);

    if (!tool) throw new Error(`No tool ${name}`);

    const result = await tool.execute(params, api, BACKGROUND_CONTEXT);

    return { text: contentText(result.content ?? []), details: result.details };
  }

  return { run, desk, asked };
}

test("themes read with why they matter, what they could reach and what watching them found", async () => {
  const { run, desk } = setup();

  expect((await run(AgentToolName.GetThemes, {})).text).toBe(
    "The user watches no themes yet."
  );

  const { id } = desk.save(OUTBREAK, "outbreak");

  await desk.take(id, [
    {
      id: "spread",
      url: null,
      title: "Cases confirmed across the border",
      snippet: "",
      site: "news.test",
      published: {
        at: new Date("2026-10-09T02:00:00Z"),
        precision: TimePrecision.Minute,
      },
      foundAt: AT,
    },
  ]);

  const { text, details } = await run(AgentToolName.GetThemes, {});

  expect(text.split("\n")).toEqual([
    "## Outbreak near the border (id outbreak)",
    "A wider outbreak could close ports and slow shipping.",
    "Listings it could reach:",
    "- TW 2603: Port closures cut its sailings.",
    "Signposts:",
    "- Cases are confirmed in a second country.",
    "Searched for: outbreak border; 疫情 邊境",
    "Last searched 2026-10-10.",
    "News a decisions model read as stating a signpost; read the item before you rely on it:",
    '- "Cases are confirmed in a second country.": 2026-10-09 news.test: Cases confirmed across the border (read as stated, 0.90)',
    "Found last:",
    "- 2026-10-09 news.test: Cases confirmed across the border",
  ]);
  expect(details).toEqual({ themes: 1 });
});

test("a theme is kept once the user allows it, and the call's second run writes the same one", async () => {
  const { run, desk, asked } = setup();

  const first = await run(AgentToolName.SaveTheme, OUTBREAK);
  const again = await run(AgentToolName.SaveTheme, OUTBREAK);

  expect(first.text).toMatch(/^Kept theme \w+, "Outbreak near the border"\.$/);
  expect(again.details).toEqual(first.details);
  expect(desk.list()).toHaveLength(1);
  expect(asked).toHaveBeenCalledTimes(2);
});

test("a theme is written again under its id, and an id no theme has is refused before the user is asked", async () => {
  const { run, desk, asked } = setup();

  desk.save(OUTBREAK, "outbreak");

  expect(
    await run(AgentToolName.SaveTheme, {
      ...OUTBREAK,
      id: "outbreak",
      thesis: "It is spreading.",
    })
  ).toMatchObject({
    text: 'Wrote theme outbreak, "Outbreak near the border".',
  });
  expect(desk.list()[0].theme.thesis).toBe("It is spreading.");

  asked.mockClear();

  await expect(
    run(AgentToolName.SaveTheme, { ...OUTBREAK, id: "gone" })
  ).rejects.toThrow("No theme has the id gone");
  expect(asked).not.toHaveBeenCalled();
});
