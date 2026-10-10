import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { getTableConfig } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";

import { InstrumentKind, Market } from "@solyx/core/market";
import { TimePrecision } from "@solyx/core/news";
import { OrderType, Side } from "@solyx/core/order";
import {
  ProposalSource,
  ProposalStatus,
  SubmissionFailureCode,
} from "@solyx/core/order-desk";
import type { TradeProposal } from "@solyx/core/order-desk";
import { RiskViolationCode } from "@solyx/core/risk";
import { ScheduleApproval, ScheduleKind } from "@solyx/core/schedule";
import type { ScheduledTask } from "@solyx/core/schedule";
import type { Theme, ThemeItem } from "@solyx/core/theme";

import {
  paperAccount,
  proposals,
  scheduledTasks,
  themeItems,
  themeReadings,
  themes,
  watchlist,
} from "../src/user-schema.ts";
import { openUserData } from "../src/user.ts";
import type { UserData } from "../src/user.ts";

const MIGRATIONS = fileURLToPath(
  new URL("../migrations/user", import.meta.url)
);

const TSMC = { market: Market.TW, symbol: "2330" };

const FOXCONN = { market: Market.TW, symbol: "2317" };

const APPLE = { market: Market.US, symbol: "AAPL" };

function proposal(id: string, patch: Partial<TradeProposal> = {}) {
  return {
    id,
    order: {
      instrument: { ...TSMC, kind: InstrumentKind.Stock },
      side: Side.Buy,
      quantity: 1000,
      type: OrderType.Limit,
      limitPrice: 980,
    },
    source: ProposalSource.Agent,
    rationale: "breakout",
    createdAt: 1_700_000_000_000,
    status: ProposalStatus.AwaitingConfirmation,
    violations: [],
    ...patch,
  } satisfies TradeProposal;
}

let directory: string;

let opened: UserData[];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-user-"));
  opened = [];
});

afterEach(async () => {
  for (const userData of opened) userData.close();
  await rm(directory, { recursive: true, force: true });
});

function open(file = "user.sqlite") {
  const userData = openUserData(join(directory, file), MIGRATIONS);

  opened.push(userData);

  return userData;
}

describe("openUserData", () => {
  // A schema change committed without `db:generate` fails here.
  test.each([
    watchlist,
    proposals,
    paperAccount,
    scheduledTasks,
    themes,
    themeItems,
    themeReadings,
  ])("migrations build the tables the schema describes", (table) => {
    open().close();
    opened = [];

    const db = new DatabaseSync(join(directory, "user.sqlite"));
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
  });

  test("a file that is not a database is kept and reported", async () => {
    const file = join(directory, "garbage.sqlite");

    await writeFile(file, "not a database");

    expect(() => openUserData(file, MIGRATIONS)).toThrow();

    const kept = new DatabaseSync(file, { readOnly: true });

    expect(() => kept.prepare("SELECT 1").get()).toThrow();
    kept.close();
  });

  test("the watchlist outlives the connection", () => {
    const first = open();

    first.watchlist.add(TSMC);
    first.close();
    opened = [];

    expect(open().watchlist.list()).toEqual([TSMC]);
  });
});

describe("watchlist store", () => {
  test("listings keep the order they were added in", () => {
    const { watchlist: store } = open();

    store.add(TSMC);
    store.add(APPLE);
    store.add(FOXCONN);

    expect(store.list()).toEqual([TSMC, APPLE, FOXCONN]);
  });

  test("adding a watched listing again keeps its place", () => {
    const { watchlist: store } = open();

    store.add(TSMC);
    store.add(APPLE);
    store.add(TSMC);

    expect(store.list()).toEqual([TSMC, APPLE]);
  });

  test("removing drops only that listing", () => {
    const { watchlist: store } = open();

    store.add(TSMC);
    store.add(APPLE);
    store.remove(TSMC);
    store.remove(FOXCONN);

    expect(store.list()).toEqual([APPLE]);
  });

  test("clearing stops watching every listing", () => {
    const { watchlist: store } = open();

    store.add(TSMC);
    store.add(APPLE);
    store.clear();

    expect(store.list()).toEqual([]);
  });

  test("markets keep the same code apart", () => {
    const { watchlist: store } = open();
    const listedTwice = { market: Market.US, symbol: "2330" };

    store.add(TSMC);
    store.add(listedTwice);
    store.remove(listedTwice);

    expect(store.list()).toEqual([TSMC]);
  });

  test("a moved listing takes its index among the others, across connections", () => {
    const first = open();

    first.watchlist.add(TSMC);
    first.watchlist.add(APPLE);
    first.watchlist.add(FOXCONN);
    first.watchlist.move(FOXCONN, 0);
    first.watchlist.move(TSMC, 99);
    first.close();
    opened = [];

    expect(open().watchlist.list()).toEqual([FOXCONN, APPLE, TSMC]);
  });

  test("a listing added after a move goes last", () => {
    const { watchlist: store } = open();

    store.add(TSMC);
    store.add(APPLE);
    store.move(APPLE, 0);
    store.add(FOXCONN);

    expect(store.list()).toEqual([APPLE, TSMC, FOXCONN]);
  });

  test("moving a listing that is not watched changes nothing", () => {
    const { watchlist: store } = open();

    store.add(TSMC);
    store.add(APPLE);
    store.move(FOXCONN, 0);

    expect(store.list()).toEqual([TSMC, APPLE]);
  });

  test("listings saved before they had positions keep the order they were added in", () => {
    const { watchlist: store } = open();

    store.add(TSMC);
    store.add(APPLE);

    const db = new DatabaseSync(join(directory, "user.sqlite"));

    db.exec("UPDATE watchlist SET position = 0");
    db.close();

    store.add(FOXCONN);

    expect(store.list()).toEqual([TSMC, APPLE, FOXCONN]);
  });
});

describe("proposal store", () => {
  test("proposals keep the order they were made in", () => {
    const { proposals: store } = open();

    store.add(proposal("b"));
    store.add(proposal("a"));
    store.add(proposal("c"));

    expect(store.list().map(({ id }) => id)).toEqual(["b", "a", "c"]);
  });

  test("a proposal reads back as it was stored", () => {
    const { proposals: store } = open();

    const rejected = proposal("a", {
      status: ProposalStatus.Rejected,
      violations: [{ code: RiskViolationCode.OddLotMarketOrder }],
    });

    store.add(rejected);

    expect(store.get("a")).toStrictEqual(rejected);
    expect(store.get("missing")).toBeUndefined();
  });

  test("updating replaces what changed and keeps the rest", () => {
    const { proposals: store } = open();

    store.add(proposal("a"));
    store.add(proposal("b"));

    const failed = proposal("a", {
      status: ProposalStatus.Failed,
      failure: { code: SubmissionFailureCode.Error, message: "timeout" },
    });

    store.update(failed);

    expect(store.list()).toStrictEqual([failed, proposal("b")]);
  });

  test("the paper account has none until written, then reads back what was written last", () => {
    const store = open().paperAccount;

    expect(store.read()).toBeUndefined();

    store.write({ cash: { TWD: 1_000_000 }, positions: [], orders: 0 });

    const after = {
      cash: { TWD: 20_000, USD: 30_000 },
      positions: [
        {
          instrument: { ...TSMC, kind: InstrumentKind.Stock },
          quantity: 1000,
          avgPrice: 980,
        },
      ],
      orders: 1,
    };

    store.write(after);

    expect(store.read()).toStrictEqual(after);
  });

  test("proposals outlive the connection", () => {
    const first = open();

    const submitted = proposal("a", {
      status: ProposalStatus.Submitted,
      brokerOrderId: "B-1",
    });

    first.proposals.add(submitted);
    first.close();
    opened = [];

    expect(open().proposals.list()).toStrictEqual([submitted]);
  });
});

describe("schedule store", () => {
  const brief: ScheduledTask = {
    id: "brief",
    name: "Morning brief",
    prompt: "/watchlist-upkeep",
    schedule: {
      kind: ScheduleKind.FixedTime,
      time: "08:30",
      tradingDaysOf: Market.TW,
    },
    timeZone: "Asia/Taipei",
    locale: "zh-TW",
    approval: ScheduleApproval.Auto,
    enabled: true,
    createdAt: 1_790_000_000_000,
    updatedAt: 1_790_000_000_000,
    lastRun: null,
  };

  const hourly: ScheduledTask = {
    ...brief,
    id: "hourly",
    name: "Hourly check",
    schedule: { kind: ScheduleKind.Interval, everyMinutes: 60 },
  };

  test("tasks keep the order they were made in, and saving one again replaces it", () => {
    const { schedules } = open();

    schedules.save(brief);
    schedules.save(hourly);

    const ran = {
      ...brief,
      enabled: false,
      lastRun: { at: 1_790_000_100_000, sessionId: "7", failure: null },
    };

    schedules.save(ran);

    expect(schedules.list()).toStrictEqual([ran, hourly]);
    expect(schedules.get("brief")).toStrictEqual(ran);
    expect(schedules.get("gone")).toBeUndefined();
  });

  test("a removed task is gone, and the rest outlive the connection", () => {
    const first = open();

    first.schedules.save(brief);
    first.schedules.save(hourly);
    first.schedules.remove("brief");
    first.close();
    opened = [];

    expect(open().schedules.list()).toStrictEqual([hourly]);
  });
});

describe("theme store", () => {
  const outbreak: Theme = {
    id: "outbreak",
    title: "Outbreak near the border",
    thesis: "A wider outbreak could close ports.",
    queries: ["outbreak border"],
    signposts: ["A port suspends operations."],
    listings: [
      {
        symbol: { market: Market.TW, symbol: "2603" },
        exposure: "Fewer sailings.",
      },
    ],
    createdAt: 1_790_000_000_000,
    updatedAt: 1_790_000_000_000,
  };

  const found = (id: string, foundAt: number): ThemeItem => ({
    id,
    title: id,
    snippet: "",
    url: `https://news.test/${id}`,
    site: "news.test",
    published: {
      at: new Date(foundAt - 1000),
      precision: TimePrecision.Minute,
    },
    foundAt,
  });

  test("a theme written again keeps its place and age, and its searches' time", () => {
    const { themes: store } = open();

    store.save(outbreak);
    store.save({ ...outbreak, id: "tariffs", title: "Tariffs" });
    store.markCollected("outbreak", 5);
    store.save({
      ...outbreak,
      thesis: "It is spreading.",
      createdAt: 9,
      updatedAt: 9,
    });

    expect(
      store
        .list()
        .map(({ id, thesis, createdAt, updatedAt }) => [
          id,
          thesis,
          createdAt,
          updatedAt,
        ])
    ).toEqual([
      ["outbreak", "It is spreading.", outbreak.createdAt, 9],
      ["tariffs", outbreak.thesis, outbreak.createdAt, outbreak.updatedAt],
    ]);
    expect(store.collectedAt("outbreak")).toBe(5);
    expect(store.collectedAt("tariffs")).toBe(null);
    expect(store.get("gone")).toBeUndefined();
  });

  test("an item is kept once per theme, the last found first, and a reading once per signpost and item", () => {
    const { themes: store } = open();

    store.save(outbreak);
    store.addItems("outbreak", [found("a", 1), found("b", 2)]);
    store.addItems("outbreak", [
      { ...found("a", 3), title: "found again" },
      found("c", 3),
    ]);

    expect(store.items("outbreak", 2)).toStrictEqual([
      found("c", 3),
      found("b", 2),
    ]);

    const reading = {
      signpost: "A port suspends operations.",
      itemId: "a",
      support: { model: "jev", supported: 0.9 },
      checkedAt: 4,
    };

    store.addReading("outbreak", reading);
    store.addReading("outbreak", {
      ...reading,
      support: { model: "jev", supported: 0.1 },
    });

    expect(store.readings("outbreak")).toStrictEqual([reading]);
  });

  test("removing a theme removes what was found and read for it", () => {
    const { themes: store } = open();

    store.save(outbreak);
    store.addItems("outbreak", [found("a", 1)]);
    store.addReading("outbreak", {
      signpost: "A port suspends operations.",
      itemId: "a",
      support: { model: "jev", supported: 0.9 },
      checkedAt: 4,
    });
    store.remove("outbreak");

    expect(store.list()).toEqual([]);
    expect(store.items("outbreak", 10)).toEqual([]);
    expect(store.readings("outbreak")).toEqual([]);
  });
});
