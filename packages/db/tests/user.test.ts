import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { getTableConfig } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";

import { InstrumentKind, Market } from "@solyx/core/market";
import { OrderType, Side } from "@solyx/core/order";
import {
  ProposalSource,
  ProposalStatus,
  SubmissionFailureCode,
} from "@solyx/core/order-desk";
import type { TradeProposal } from "@solyx/core/order-desk";
import { RiskViolationCode } from "@solyx/core/risk";

import { paperAccount, proposals, watchlist } from "../src/user-schema.ts";
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
  test.each([watchlist, proposals, paperAccount])(
    "migrations build the tables the schema describes",
    (table) => {
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
    }
  );

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
