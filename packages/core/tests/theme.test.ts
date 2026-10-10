import { expect, test, vi } from "vite-plus/test";

import { Market } from "../src/market.ts";
import { TimePrecision } from "../src/news.ts";
import { ThemeDesk, themeDraftSchema } from "../src/theme.ts";
import type {
  SignpostReading,
  Theme,
  ThemeDraft,
  ThemeItem,
  ThemeStore,
} from "../src/theme.ts";

const AT = Date.parse("2026-10-10T09:00:00+08:00");

const DAY_MS = 24 * 60 * 60 * 1000;

const OUTBREAK: ThemeDraft = {
  title: "Outbreak near the border",
  thesis: "A wider outbreak could close ports and slow shipping.",
  queries: ["outbreak border", "疫情 邊境"],
  signposts: [
    "Cases are confirmed in a second country.",
    "A port suspends operations.",
  ],
  listings: [
    {
      symbol: { market: Market.TW, symbol: "2603" },
      exposure: "Port closures cut its sailings.",
    },
  ],
};

function item(id: string, publishedAt: number | null, foundAt = AT): ThemeItem {
  return {
    id,
    title: id,
    snippet: "",
    url: `https://news.test/${id}`,
    site: "news.test",
    published:
      publishedAt === null
        ? null
        : { at: new Date(publishedAt), precision: TimePrecision.Minute },
    foundAt,
  };
}

// Copies on the way in and out, like a database would, so the desk cannot lean on shared objects.
function memoryStore(): ThemeStore {
  const themes = new Map<string, Theme>();
  const items = new Map<string, ThemeItem[]>();
  const readings = new Map<string, SignpostReading[]>();
  const collected = new Map<string, number>();

  return {
    list: () => [...themes.values()].map((theme) => structuredClone(theme)),
    get: (id) => structuredClone(themes.get(id)),
    save: (theme) => void themes.set(theme.id, structuredClone(theme)),
    remove(id) {
      themes.delete(id);
      items.delete(id);
      readings.delete(id);
    },
    items: (themeId, limit) =>
      structuredClone((items.get(themeId) ?? []).toReversed().slice(0, limit)),
    addItems(themeId, found) {
      const kept = items.get(themeId) ?? [];

      items.set(themeId, [
        ...kept,
        ...structuredClone(
          found.filter((each) => !kept.some(({ id }) => id === each.id))
        ),
      ]);
    },
    readings: (themeId) => structuredClone(readings.get(themeId) ?? []),
    addReading: (themeId, reading) =>
      void readings.set(themeId, [...(readings.get(themeId) ?? []), reading]),
    collectedAt: (themeId) => collected.get(themeId) ?? null,
    markCollected: (themeId, at) => void collected.set(themeId, at),
  };
}

function setup() {
  const clock = { now: AT };
  const store = memoryStore();
  const onChange = vi.fn();

  const audit = vi.fn(
    async ({ text, quote }: { text: string; quote: string }) => ({
      model: "jev",
      supported:
        text.startsWith("Cases") && quote.includes("second country")
          ? 0.9
          : 0.1,
    })
  );

  let ids = 0;

  const desk = new ThemeDesk({
    store,
    auditor: async () => ({ audit }),
    onChange,
    now: () => clock.now,
    createId: () => `theme-${(ids += 1)}`,
  });

  return { desk, store, clock, audit, onChange };
}

test("a theme is kept as written, and writing it again keeps its id, age and what was found", async () => {
  const { desk, clock, onChange } = setup();

  const theme = desk.save(OUTBREAK);

  await desk.take(theme.id, [item("first", AT)]);
  clock.now = AT + DAY_MS;

  expect(
    desk.save({ ...OUTBREAK, thesis: "It is spreading." }, theme.id)
  ).toEqual({
    ...OUTBREAK,
    thesis: "It is spreading.",
    id: "theme-1",
    createdAt: AT,
    updatedAt: AT + DAY_MS,
  });
  expect(desk.list()).toMatchObject([
    { theme: { id: "theme-1" }, latest: [{ id: "first" }], collectedAt: AT },
  ]);
  expect(desk.save(OUTBREAK, "chosen")).toMatchObject({
    id: "chosen",
    createdAt: AT + DAY_MS,
  });
  expect(onChange).toHaveBeenCalledTimes(4);
});

test("each new item is read against each signpost once, and one read as stating it is a development", async () => {
  const { desk, audit } = setup();
  const { id } = desk.save(OUTBREAK);

  const spread = {
    ...item("spread", AT - DAY_MS),
    title: "Cases confirmed in a second country",
  };

  await desk.take(id, [spread, item("quiet", AT - 2 * DAY_MS)]);

  expect(audit).toHaveBeenCalledTimes(4);
  expect(audit).toHaveBeenCalledWith({
    text: "Cases are confirmed in a second country.",
    source: "https://news.test/spread",
    quote: "Cases confirmed in a second country",
  });

  await desk.take(id, [spread, item("later", AT)]);

  // Only the new item is read, against both signposts.
  expect(audit).toHaveBeenCalledTimes(6);
  expect(desk.list()).toMatchObject([
    {
      developments: [
        {
          signpost: "Cases are confirmed in a second country.",
          item: { id: "spread" },
          support: { supported: 0.9 },
        },
      ],
      quietSince: AT - DAY_MS,
    },
  ]);
});

test("a theme with a development comes first, and one without counts its quiet from when it was written", async () => {
  const { desk, clock } = setup();
  const outbreak = desk.save(OUTBREAK);

  clock.now = AT + DAY_MS;

  const tariffs = desk.save({ ...OUTBREAK, title: "Tariffs" });

  expect(
    desk.list().map(({ theme, quietSince }) => [theme.title, quietSince])
  ).toEqual([
    ["Tariffs", AT + DAY_MS],
    ["Outbreak near the border", AT],
  ]);

  await desk.take(outbreak.id, [
    {
      ...item("spread", AT - 3 * DAY_MS),
      title: "Cases confirmed in a second country",
    },
  ]);

  expect(desk.list().map(({ theme }) => theme.id)).toEqual([
    outbreak.id,
    tariffs.id,
  ]);
});

test("an item found before a decisions model was set up, or before a signpost was written, is read later; a rewritten signpost's readings drop", async () => {
  const store = memoryStore();
  const clock = { now: AT };
  const audit = vi.fn(async () => ({ model: "jev", supported: 0.9 }));
  let auditor: { audit: typeof audit } | undefined;

  const desk = new ThemeDesk({
    store,
    auditor: async () => auditor,
    now: () => clock.now,
    createId: () => "theme-1",
  });

  desk.save(OUTBREAK);
  await desk.take("theme-1", [item("first", AT)]);

  expect(desk.list()[0]).toMatchObject({
    developments: [],
    latest: [{ id: "first" }],
  });

  auditor = { audit };
  await desk.take("theme-1", []);

  expect(audit).toHaveBeenCalledTimes(2);
  expect(desk.list()[0].developments).toHaveLength(2);

  desk.save(
    {
      ...OUTBREAK,
      signposts: ["A port suspends operations.", "Flights stop."],
    },
    "theme-1"
  );

  expect(desk.list()[0].developments.map(({ signpost }) => signpost)).toEqual([
    "A port suspends operations.",
  ]);

  audit.mockRejectedValueOnce(new Error("The model is out of reach"));
  await desk.take("theme-1", []);
  await desk.take("theme-1", []);

  // The new signpost is read once the model answers, and never twice.
  expect(audit).toHaveBeenCalledTimes(4);
  expect(desk.list()[0].developments).toHaveLength(2);
});

test("a removed theme takes what was found for it, and nothing is taken for one that is gone", async () => {
  const { desk, store } = setup();
  const { id } = desk.save(OUTBREAK);

  await desk.take(id, [item("first", AT)]);
  desk.remove(id);
  await desk.take(id, [item("second", AT)]);

  expect(desk.list()).toEqual([]);
  expect(store.items(id, 10)).toEqual([]);
});

test("a draft needs a search and a signpost, and refuses text that looks like a key", () => {
  const refused = [
    { ...OUTBREAK, queries: [] },
    { ...OUTBREAK, signposts: [] },
    { ...OUTBREAK, thesis: "Read it with sk-abcdefghijklmnopqrstuvwxyz." },
  ];

  expect(themeDraftSchema.safeParse(OUTBREAK).success).toBe(true);
  expect(
    refused.map((each) => themeDraftSchema.safeParse(each).success)
  ).toEqual([false, false, false]);
});
