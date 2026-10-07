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
import { ReportStance } from "@solyx/core/report";
import type { Report } from "@solyx/core/report";

import { forecasts, reports } from "../src/research-schema.ts";
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
test.each([reports, forecasts])(
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
