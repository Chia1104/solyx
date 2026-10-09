import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { getTableConfig } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";

import { ForecastDirection } from "@solyx/core/forecast";
import type { Forecast, ForecastOutcome } from "@solyx/core/forecast";
import { InstrumentKind, Market } from "@solyx/core/market";
import { TimePrecision } from "@solyx/core/news";
import { ReportStance } from "@solyx/core/report";
import type { Report } from "@solyx/core/report";
import type { FalsifierCheck } from "@solyx/core/research";

import { falsifierChecks, forecasts, reports } from "../src/research-schema.ts";
import { openResearch } from "../src/research.ts";
import type { ResearchData } from "../src/research.ts";

const MIGRATIONS = fileURLToPath(
  new URL("../migrations/research", import.meta.url)
);

const TSMC = { market: Market.TW, symbol: "2330" };

const MEDIATEK = { market: Market.TW, symbol: "2454" };

function report(revision: number, patch: Partial<Report> = {}): Report {
  return {
    symbol: TSMC,
    revision,
    revisedAt: 1_790_000_000_000 + revision,
    financialsThrough: "2026-06-30",
    stance: ReportStance.Bullish,
    thesis: "Advanced nodes stay sold out.",
    drivers: [],
    risks: [],
    falsifiers: [],
    valuation: null,
    events: [],
    sections: {},
    ...patch,
  };
}

function forecast(id: string, patch: Partial<Forecast> = {}): Forecast {
  return {
    id,
    instrument: { ...TSMC, kind: InstrumentKind.Stock },
    horizon: 2,
    direction: ForecastDirection.Neutral,
    plan: null,
    scenarios: [
      {
        label: "Down",
        probability: 40,
        low: null,
        high: 1000,
        path: [{ session: 2, price: 980 }],
      },
      {
        label: "Up",
        probability: 60,
        low: 1000,
        high: null,
        path: [{ session: 2, price: 1030 }],
      },
    ],
    rationale: "Range-bound into results.",
    claims: [],
    contrary: null,
    createdAt: 1_790_000_000_000,
    anchor: { date: "2026-09-29", price: 1000 },
    reportRevision: 1,
    council: null,
    outcome: null,
    ...patch,
  };
}

const OUTCOME: ForecastOutcome = {
  date: "2026-10-01",
  close: 1020,
  scenario: 1,
  brier: 0.32,
  plan: null,
};

let directory: string;

let opened: ResearchData[];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-research-"));
  opened = [];
});

afterEach(async () => {
  for (const research of opened) research.close();
  await rm(directory, { recursive: true, force: true });
});

function open() {
  const research = openResearch(join(directory, "research.sqlite"), MIGRATIONS);

  opened.push(research);

  return research;
}

// A schema change committed without `db:generate` fails here.
test.each([reports, forecasts, falsifierChecks])(
  "migrations build the table the schema describes",
  (table) => {
    open().close();
    opened = [];

    const db = new DatabaseSync(join(directory, "research.sqlite"));
    const config = getTableConfig(table);

    const columns = db
      .prepare(`SELECT name, type, "notnull" FROM pragma_table_info(?)`)
      .all(config.name)
      .map((column) => [
        column.name,
        String(column.type).toLowerCase(),
        column.notnull === 1,
      ]);

    db.close();

    expect(columns).toEqual(
      config.columns.map((column) => [
        column.name,
        column.getSQLType(),
        column.notNull && !column.primary,
      ])
    );
  }
);

test("a listing's newest revision is its report, across opens", () => {
  const first = open();

  first.store.addReport(report(1));
  first.store.addReport(report(2, { stance: ReportStance.Neutral }));
  first.store.addReport(report(1, { symbol: MEDIATEK }));
  first.close();
  opened = [];

  const { store } = open();

  expect(store.report(TSMC)).toEqual(
    report(2, { stance: ReportStance.Neutral })
  );
  expect(store.report(MEDIATEK)?.revision).toBe(1);
  expect(store.report({ market: Market.US, symbol: "AAPL" })).toBeUndefined();
});

test("forecasts read back as made, oldest first, for one listing or all", () => {
  const { store } = open();

  const mediatek = forecast("b", {
    instrument: { ...MEDIATEK, kind: InstrumentKind.Stock },
  });

  store.addForecast(forecast("a"));
  store.addForecast(mediatek);
  store.addForecast(
    forecast("c", { anchor: { date: "2026-09-30", price: 1010 } })
  );

  expect(store.forecast("a")).toEqual(forecast("a"));
  expect(store.forecast("gone")).toBeUndefined();
  expect(store.forecasts().map(({ id }) => id)).toEqual(["a", "b", "c"]);
  expect(store.forecasts(TSMC).map(({ id }) => id)).toEqual(["a", "c"]);
});

test("a listing takes one forecast per session", () => {
  const { store } = open();

  store.addForecast(forecast("a"));

  expect(() => store.addForecast(forecast("b"))).toThrow();
});

test("an outcome is kept once", () => {
  const { store } = open();

  store.addForecast(forecast("a"));
  store.settle("a", OUTCOME);
  store.settle("a", { ...OUTCOME, close: 900 });

  expect(store.forecast("a")?.outcome).toEqual(OUTCOME);
});

test("usage counts listings with a report and forecasts, and clearing empties both", () => {
  const research = open();

  research.store.addReport(report(1));
  research.store.addReport(report(2));
  research.store.addReport(report(1, { symbol: MEDIATEK }));
  research.store.addForecast(forecast("a"));

  expect(research.usage()).toMatchObject({ reports: 2, forecasts: 1 });
  expect(research.usage().bytes).toBeGreaterThan(0);

  research.clear();

  expect(research.usage()).toMatchObject({ reports: 0, forecasts: 0 });
  expect(research.store.report(TSMC)).toBeUndefined();
});

test("a search finds each listing's newest revision holding a word, best first", () => {
  const { store } = open();

  store.addReport(
    report(1, {
      thesis: "CoWoS capacity doubles and advanced packaging sells out.",
    })
  );
  store.addReport(report(2, { thesis: "先進封裝產能翻倍，CoWoS 供不應求。" }));
  store.addReport(report(3));
  store.addReport(
    report(1, {
      symbol: MEDIATEK,
      sections: {
        business: { text: "Handsets lean on advanced nodes.", revisedAt: 0 },
      },
    })
  );

  expect(
    store
      .searchReports("CoWoS", 5)
      .map(({ symbol, revision }) => [symbol.symbol, revision])
  ).toEqual([["2330", 2]]);
  expect(
    store.searchReports("先進封裝", 5).map(({ revision }) => revision)
  ).toEqual([2]);
  expect(
    store.searchReports("advanced nodes", 5).map(({ symbol }) => symbol.symbol)
  ).toEqual(["2454", "2330"]);
  expect(
    store
      .searchReports("advanced", 5, MEDIATEK)
      .map(({ symbol }) => symbol.symbol)
  ).toEqual(["2454"]);
  expect(store.searchReports("advanced", 1)).toHaveLength(1);
  expect(store.searchReports("…", 5)).toEqual([]);
});

test("a search finds forecasts by their rationale, claims and listing", () => {
  const { store } = open();

  store.addForecast(
    forecast("a", {
      claims: [
        {
          text: "Revenue rose 30%.",
          source: "MOPS",
          quote: "營收年增 30%",
          support: null,
        },
      ],
    })
  );
  store.addForecast(
    forecast("b", {
      instrument: { ...MEDIATEK, kind: InstrumentKind.Stock },
      rationale: "Results day; the range should break.",
    })
  );
  store.settle("a", OUTCOME);

  expect(store.searchForecasts("營收", 5)).toEqual([
    forecast("a", {
      claims: [
        {
          text: "Revenue rose 30%.",
          source: "MOPS",
          quote: "營收年增 30%",
          support: null,
        },
      ],
      outcome: OUTCOME,
    }),
  ]);
  expect(store.searchForecasts("results", 5).map(({ id }) => id)).toEqual([
    "b",
    "a",
  ]);
  expect(store.searchForecasts("results", 5, TSMC).map(({ id }) => id)).toEqual(
    ["a"]
  );
  expect(store.searchForecasts("2454", 5).map(({ id }) => id)).toEqual(["b"]);
});

test("research kept before its search existed is found once the file opens", () => {
  const first = open();

  first.store.addReport(report(1, { thesis: "Dividend grows every year." }));
  first.store.addForecast(forecast("a", { rationale: "Dividend day ahead." }));
  first.close();
  opened = [];

  const db = new DatabaseSync(join(directory, "research.sqlite"));

  db.exec(
    "INSERT INTO report_terms (report_terms) VALUES ('delete-all'); INSERT INTO forecast_terms (forecast_terms) VALUES ('delete-all');"
  );
  db.close();

  const { store } = open();

  expect(
    store.searchReports("dividend", 5).map(({ revision }) => revision)
  ).toEqual([1]);
  expect(store.searchForecasts("dividend", 5).map(({ id }) => id)).toEqual([
    "a",
  ]);
});

test("clearing research empties its search", () => {
  const research = open();

  research.store.addReport(report(1));
  research.store.addForecast(forecast("a"));
  research.clear();

  expect(research.store.searchReports("advanced", 5)).toEqual([]);
  expect(research.store.searchForecasts("range", 5)).toEqual([]);
});

function check(
  item: string,
  patch: Partial<FalsifierCheck> = {}
): FalsifierCheck {
  return {
    falsifier: "Gross margin falls below 53%",
    revision: 1,
    source: "news",
    item: {
      id: item,
      title: item,
      url: `https://news.test/${item}`,
      site: "news.test",
      published: {
        at: new Date("2026-10-01T02:00:00Z"),
        precision: TimePrecision.Minute,
      },
    },
    support: { model: "jev", supported: 0.9 },
    checkedAt: 1_790_000_000_000,
    ...patch,
  };
}

test("a falsifier is read against an item once per revision, and clearing forgets every reading", () => {
  const research = open();
  const { store } = research;

  store.addFalsifierCheck(TSMC, check("a"));
  store.addFalsifierCheck(
    TSMC,
    check("a", { support: { model: "jev", supported: 0.1 } })
  );
  store.addFalsifierCheck(
    TSMC,
    check("b", {
      item: { ...check("b").item, url: null, published: null },
    })
  );
  store.addFalsifierCheck(TSMC, check("a", { revision: 2 }));
  store.addFalsifierCheck(MEDIATEK, check("a"));

  expect(store.falsifierChecks(TSMC, 1)).toEqual([
    check("a"),
    check("b", { item: { ...check("b").item, url: null, published: null } }),
  ]);
  expect(store.falsifierChecks(TSMC, 2)).toEqual([check("a", { revision: 2 })]);

  research.clear();

  expect(store.falsifierChecks(TSMC, 1)).toEqual([]);
});
