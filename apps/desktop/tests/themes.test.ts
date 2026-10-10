import { expect, test, vi } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import type {
  SignpostReading,
  Theme,
  ThemeDraft,
  ThemeItem,
  ThemeStore,
} from "@solyx/core/theme";
import { WebSearchKind } from "@solyx/core/web-search";
import type { WebResult, WebSearch } from "@solyx/core/web-search";

import { createThemes } from "../src/main/modules/themes/themes.ts";

const START = Date.parse("2026-10-10T09:00:00+08:00");

const HOUR_MS = 60 * 60 * 1000;

const DAY_MS = 24 * HOUR_MS;

const OUTBREAK: ThemeDraft = {
  title: "Outbreak near the border",
  thesis: "A wider outbreak could close ports.",
  queries: ["outbreak border", "疫情 邊境"],
  signposts: ["A port suspends operations."],
  listings: [
    {
      symbol: { market: Market.TW, symbol: "2603" },
      exposure: "Fewer sailings.",
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
    addItems(themeId, found) {
      const kept = items.get(themeId) ?? [];

      items.set(themeId, [
        ...kept,
        ...found.filter((each) => !kept.some(({ id }) => id === each.id)),
      ]);
    },
    readings: (themeId) => readings.get(themeId) ?? [],
    addReading: (themeId, reading) =>
      void readings.set(themeId, [...(readings.get(themeId) ?? []), reading]),
    collectedAt: (themeId) => collected.get(themeId) ?? null,
    markCollected: (themeId, at) => void collected.set(themeId, at),
  };
}

const page = (name: string): WebResult => ({
  url: `https://news.test/${name}`,
  title: name,
  snippet: "",
  site: "news.test",
  published: null,
});

function setup() {
  const clock = { now: START };
  const store = memoryStore();

  const search = vi.fn<WebSearch["search"]>(async ({ text }) => [
    page(`${text} one`),
  ]);

  const web = vi.fn(async (): Promise<WebSearch | undefined> => ({ search }));
  const diagnostics = { recovered: vi.fn() };
  const onChange = vi.fn();

  const themes = createThemes({
    store,
    web,
    auditor: async () => undefined,
    diagnostics,
    onChange,
    now: () => clock.now,
  });

  return { themes, store, clock, search, web, diagnostics, onChange };
}

test("each theme's queries are searched for news once a day, on no market's calendar", async () => {
  const { themes, clock, search } = setup();
  const { id } = themes.desk.save(OUTBREAK);

  await themes.work.run();

  expect(search.mock.calls.map(([query]) => query)).toEqual([
    {
      text: "outbreak border",
      kind: WebSearchKind.News,
      since: new Date(START - 14 * DAY_MS),
      sites: [],
      market: null,
      limit: 10,
    },
    expect.objectContaining({ text: "疫情 邊境" }),
  ]);
  expect(themes.desk.list()).toMatchObject([
    {
      theme: { id },
      latest: [{ title: "疫情 邊境 one" }, { title: "outbreak border one" }],
      collectedAt: START,
    },
  ]);

  clock.now = START + DAY_MS - HOUR_MS;
  await themes.work.run();

  expect(search).toHaveBeenCalledTimes(2);

  clock.now = START + DAY_MS;
  await themes.work.run();

  expect(search).toHaveBeenCalledTimes(4);
  // A later search overlaps the last by a day.
  expect(search.mock.lastCall?.[0].since).toEqual(new Date(START - DAY_MS));
});

test("nothing is searched until a web search vendor is set up, and searching now says so", async () => {
  const { themes, search, web } = setup();
  const { id } = themes.desk.save(OUTBREAK);

  web.mockResolvedValue(undefined);
  await themes.work.run();

  expect(search).not.toHaveBeenCalled();
  await expect(themes.check(id)).rejects.toThrow("No web search is set up");

  web.mockResolvedValue({ search });
  await themes.check(id);

  expect(search).toHaveBeenCalledTimes(2);
});

test("a query that fails leaves the others' items, and a search that fails whole is tried again", async () => {
  const { themes, store, clock, search, diagnostics } = setup();
  const { id } = themes.desk.save(OUTBREAK);
  const failure = new Error("Tavily answered 429");

  search.mockRejectedValueOnce(failure);
  await themes.work.run();

  expect(diagnostics.recovered).toHaveBeenCalledWith(failure, "themes.search", {
    "solyx.theme": id,
  });
  expect(themes.desk.list()[0].latest).toMatchObject([
    { title: "疫情 邊境 one" },
  ]);

  clock.now = START + DAY_MS;
  search.mockRejectedValue(failure);
  await themes.work.run();

  expect(store.collectedAt(id)).toBe(START);

  search.mockResolvedValue([page("later")]);
  clock.now += HOUR_MS;
  await themes.work.run();

  expect(store.collectedAt(id)).toBe(START + DAY_MS + HOUR_MS);
});

test("a theme removed meanwhile is neither written again nor searched", async () => {
  const { themes } = setup();
  const { id } = themes.desk.save(OUTBREAK);

  themes.update(id, { ...OUTBREAK, thesis: "It is spreading." });

  expect(themes.desk.list()[0].theme.thesis).toBe("It is spreading.");

  themes.desk.remove(id);

  expect(() => themes.update(id, OUTBREAK)).toThrow("no longer exists");
  await expect(themes.check(id)).rejects.toThrow("no longer exists");
  expect(themes.desk.list()).toEqual([]);
});
