import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import * as z from "zod";

import { BrokerOrderStatus } from "@solyx/core/broker";
import { Market, exchangeDate } from "@solyx/core/market";
import { OrderType, Side } from "@solyx/core/order";
import type { Fill } from "@solyx/core/order";

import {
  FUBON_TEST_URL,
  fubonAccount,
  fubonFill,
  fubonOrder,
  openFubonSession,
} from "../src/fubon.ts";
import type { FubonFill, FubonHoldings, FubonOrder } from "../src/fubon.ts";

// Stands in for the SDK's native binding; it records calls on the module so tests can read them.
const FAKE_BINDING = `
const calls = [];

const NO_REPORT = "證券報表/表單定義資料不存在";

class CoreSdk {
  constructor(...args) {
    calls.push(["new", ...args]);
  }

  apikeyLogin(...args) {
    calls.push(["apikeyLogin", ...args]);

    // "no-reports" signs in to an account Fubon keeps no reports of gains for, as in its test environment.
    const account = { "good-key": "28", "no-reports": "29" }[args[1]];

    return account
      ? { isSuccess: true, data: [{ name: "Test", branchNo: "6460", account, accountType: "stock" }] }
      : { isSuccess: false, message: "API key rejected" };
  }

  login(...args) {
    calls.push(["login", ...args]);

    return { isSuccess: true, data: [{ name: "Test", branchNo: "6460", account: "26", accountType: "futopt" }, { name: "Test", branchNo: "6460", account: "28", accountType: "stock" }] };
  }

  logout() {
    calls.push(["logout"]);

    return true;
  }

  get stock() {
    return {
      getOrderResultsDetail(account) {
        calls.push(["getOrderResultsDetail", account.account]);

        return { isSuccess: true, data: [{ date: "2026/10/19", seqNo: "2", orderNo: "x0002", lastTime: "09:00:00.000" }] };
      },
      orderHistory(account, start, end) {
        calls.push(["orderHistory", account.account, start, end]);

        return { isSuccess: true, data: [{ date: "2026/10/16", seqNo: "1", orderNo: "x0001", lastTime: "13:00:00.000" }] };
      },
      filledHistory(account, start, end) {
        calls.push(["filledHistory", account.account, start, end]);

        const fill = { date: "2026/10/19", orderNo: "x0002", stockNo: "2881", buySell: "Sell", orderType: "Stock", filledQty: 1000, filledPrice: 66, filledTime: "09:01:00.000" };

        return { isSuccess: true, data: [fill, { ...fill, filledTime: "09:02:00.000" }, { ...fill, buySell: "Buy" }] };
      },
    };
  }

  get accounting() {
    return {
      realizedGainsAndLoses(account) {
        calls.push(["realizedGainsAndLoses", account.account]);

        return account.account === "29"
          ? { isSuccess: false, message: NO_REPORT }
          : { isSuccess: true, data: [{ date: "2026/10/19", stockNo: "2881", buySell: "Sell", orderType: "Stock", filledQty: 1000, filledPrice: 66, realizedProfit: 0, realizedLoss: 203 }] };
      },
      inventories() {
        return { isSuccess: true, data: [] };
      },
      unrealizedGainsAndLoses(account) {
        return account.account === "29"
          ? { isSuccess: false, message: NO_REPORT }
          : { isSuccess: true, data: [] };
      },
      bankRemain() {
        return { isSuccess: false, message: "此帳戶之交割銀行不在銀行餘額查詢支援範圍" };
      },
      querySettlement() {
        return { isSuccess: true, data: { account: { branchNo: "6460", account: "28" } } };
      },
    };
  }

  exchangeRealtimeToken() {
    return "sdk-token";
  }

  realtimeWsUrl(mode) {
    return "wss://" + mode + ".example.test/marketdata";
  }
}

class FugleRealtime {
  get realtimeRestUrl() {
    return "https://rest.example.test/marketdata";
  }
}

module.exports = { CoreSdk, FugleRealtime, calls };
`;

let directory: string;

let workingDirectory: string;

beforeEach(async () => {
  workingDirectory = process.cwd();
  directory = await mkdtemp(join(tmpdir(), "solyx-fubon-"));

  // Extracting fubon-neo-<version>.tgz creates a `package` folder.
  const sdk = join(directory, "package");

  await mkdir(sdk);
  await writeFile(join(sdk, "trade.js"), FAKE_BINDING);
  await writeFile(
    join(sdk, "package.json"),
    JSON.stringify({ name: "fubon-neo", version: "2.3.0" })
  );
});

afterEach(async () => {
  process.chdir(workingDirectory);
  await rm(directory, { recursive: true, force: true });
});

/** What the fake binding was asked, in order. */
function recordedCalls() {
  return z
    .object({ calls: z.array(z.array(z.unknown())) })
    .parse(
      createRequire(import.meta.url)(join(directory, "package", "trade.js"))
    ).calls;
}

const options = (apiKey: string, sdkDir = directory) => ({
  sdkDir,
  logDir: join(directory, "logs"),
  credentials: {
    personalId: "A123456789",
    apiKey,
    certPath: "/certs/A123456789.pfx",
  },
});

test("signs in with an API key and exchanges a token for Normal-mode market data", async () => {
  const session = openFubonSession(options("good-key"));

  expect(session.accounts).toHaveLength(1);
  expect(session.realtime()).toEqual({
    sdkToken: "sdk-token",
    restBaseUrl: "https://rest.example.test/marketdata",
    streamBaseUrl: "wss://normal.example.test/marketdata",
  });

  session.close();

  // The SDK writes ./log under the working directory, which holds the ID number.
  expect(process.cwd()).toBe(await realpath(join(directory, "logs")));

  expect(recordedCalls()).toEqual([
    ["new", "2.3.0"],
    [
      "apikeyLogin",
      "A123456789",
      "good-key",
      "/certs/A123456789.pfx",
      undefined,
    ],
    ["logout"],
  ]);
});

test("a refused sign-in reports Fubon's message", () => {
  expect(() => openFubonSession(options("bad-key"))).toThrow(
    "Fubon login failed: API key rejected"
  );
});

test("a folder without the SDK says so", () => {
  expect(() =>
    openFubonSession(options("good-key", join(directory, "elsewhere")))
  ).toThrow(/No Fubon Neo SDK/);
});

const day = "2026/10/19";

const orderResult = (overrides: Partial<FubonOrder> = {}): FubonOrder => ({
  date: day,
  seqNo: "00000000016",
  orderNo: "bA627",
  stockNo: "2881",
  buySell: "Buy",
  priceType: "Limit",
  price: 66,
  afterPrice: 66,
  quantity: 2000,
  filledQty: 0,
  orderType: "Stock",
  status: 10,
  userDef: "A1B2C3",
  lastTime: "09:15:06.048",
  details: [{ modifiedTime: "09:01:02.345" }],
  ...overrides,
});

describe("an order as Fubon reports it", () => {
  test("reads as the app's, numbered by its day and Fubon's order number", () => {
    expect(fubonOrder(orderResult(), "2026-10-19")).toEqual({
      id: "2026-10-19:bA627",
      tag: "A1B2C3",
      order: {
        instrument: { market: Market.TW, symbol: "2881" },
        side: Side.Buy,
        quantity: 2000,
        type: OrderType.Limit,
        limitPrice: 66,
      },
      filled: 0,
      status: BrokerOrderStatus.Working,
      placedAt: Date.parse("2026-10-19T09:01:02.345+08:00"),
    });
  });

  test.each([
    [0, BrokerOrderStatus.Pending],
    [4, BrokerOrderStatus.Pending],
    [9, BrokerOrderStatus.Pending],
    [30, BrokerOrderStatus.Cancelled],
    [40, BrokerOrderStatus.Cancelled],
    [50, BrokerOrderStatus.Filled],
    [90, BrokerOrderStatus.Refused],
  ])("status %i reads as %s", (status, read) => {
    expect(fubonOrder(orderResult({ status }), "2026-10-19")?.status).toBe(
      read
    );
  });

  test("one of an earlier day still on the book was left at its close", () => {
    expect(fubonOrder(orderResult(), "2026-10-20")?.status).toBe(
      BrokerOrderStatus.Cancelled
    );
  });

  test("a market order, and a price Fubon set, read as what the order works at", () => {
    expect(
      fubonOrder(
        orderResult({ priceType: "Market", price: null, afterPrice: null }),
        "2026-10-19"
      )?.order
    ).toMatchObject({ type: OrderType.Market });

    expect(
      fubonOrder(
        orderResult({ priceType: "LimitUp", price: null, afterPrice: 72.6 }),
        "2026-10-19"
      )?.order
    ).toMatchObject({ type: OrderType.Limit, limitPrice: 72.6 });
  });

  test("a margin order, or one Fubon has yet to number, is left out", () => {
    expect(
      fubonOrder(orderResult({ orderType: "Margin" }), "2026-10-19")
    ).toBeNull();
    expect(
      fubonOrder(orderResult({ orderNo: null, status: 4 }), "2026-10-19")
    ).toBeNull();
    expect(
      fubonOrder(orderResult({ orderNo: " ", status: 90 }), "2026-10-19")
    ).toBeNull();
  });
});

const filled = (overrides: Partial<FubonFill> = {}): FubonFill => ({
  date: day,
  orderNo: "bA627",
  stockNo: "2881",
  buySell: "Sell",
  orderType: "Stock",
  filledQty: 1000,
  filledPrice: 66.5,
  filledTime: "10:31:00.931",
  realized: -203,
  ...overrides,
});

test("a fill reads as the app's, a sale with what Fubon reckoned it realized", () => {
  expect(fubonFill(filled())).toEqual({
    orderId: "2026-10-19:bA627",
    instrument: { market: Market.TW, symbol: "2881" },
    side: Side.Sell,
    quantity: 1000,
    price: 66.5,
    filledAt: Date.parse("2026-10-19T10:31:00.931+08:00"),
    realized: -203,
  });

  expect(fubonFill(filled({ orderType: "DayTrade" }))).toBeNull();
});

test("the account holds its cash shares and spends the bank's balance with every trade not yet settled", () => {
  const holdings: FubonHoldings = {
    inventories: [
      {
        stockNo: "2881",
        orderType: "Stock",
        todayQty: 2000,
        odd: { todayQty: 300 },
      },
      {
        stockNo: "2330",
        orderType: "Margin",
        todayQty: 1000,
        odd: { todayQty: 0 },
      },
      {
        stockNo: "0050",
        orderType: "Stock",
        todayQty: 0,
        odd: { todayQty: 0 },
      },
    ],
    unrealized: [
      { stockNo: "2881", orderType: "Stock", costPrice: 60 },
      { stockNo: "2330", orderType: "Margin", costPrice: 900 },
    ],
    bank: { availableBalance: 1_000_000 },
    settlements: [
      // Settled already.
      {
        date: "2026/10/14",
        settlementDate: "2026/10/16",
        totalSettlementAmount: -50_000,
      },
      // Settles today: the bank may have taken it, so only what it takes counts.
      {
        date: "2026/10/15",
        settlementDate: "2026/10/19",
        totalSettlementAmount: 20_000,
      },
      // Settles tomorrow.
      {
        date: "2026/10/16",
        settlementDate: "2026/10/20",
        totalSettlementAmount: -100_000,
      },
      // Today's, which the fills below count.
      {
        date: "2026/10/19",
        settlementDate: "2026/10/21",
        totalSettlementAmount: -66_094,
      },
    ],
  };

  const bought: Fill = {
    orderId: "2026-10-19:x0001",
    instrument: { market: Market.TW, symbol: "2881" },
    side: Side.Buy,
    quantity: 1000,
    price: 66,
    filledAt: Date.parse("2026-10-19T09:30:00+08:00"),
    realized: null,
  };

  const working = fubonOrder(
    orderResult({ quantity: 2000, filledQty: 1000 }),
    "2026-10-19"
  );

  const account = fubonAccount(
    holdings,
    working ? [working] : [],
    [bought],
    "2026-10-19"
  );

  expect(account.positions).toEqual([
    {
      instrument: { market: Market.TW, symbol: "2881" },
      quantity: 2300,
      avgPrice: 60,
    },
  ]);

  // The fill and the 1,000 shares still working each cost 66,000 and 94.05 commission.
  expect(account.cash.TWD).toBeCloseTo(1_000_000 - 100_000 - 2 * 66_094.05);

  expect(
    fubonAccount({ ...holdings, bank: null }, [], [bought], "2026-10-19").cash
  ).toEqual({ TWD: null });
});

test("signs in to the test environment with a password, at its endpoint", async () => {
  const session = openFubonSession({
    sdkDir: directory,
    logDir: join(directory, "logs"),
    credentials: {
      personalId: "41610792",
      password: "12345678",
      certPath: "/certs/41610792.pfx",
      certPassword: "12345678",
    },
    url: FUBON_TEST_URL,
  });

  session.close();

  expect(recordedCalls().slice(0, 2)).toEqual([
    ["new", "2.3.0", 30, 2, FUBON_TEST_URL],
    ["login", "41610792", "12345678", "/certs/41610792.pfx", "12345678"],
  ]);
});

test("reads the stock account's orders, history in 30-day spans before today's", () => {
  const session = openFubonSession(options("good-key"));
  const today = exchangeDate(Market.TW);

  const from = Temporal.PlainDate.from(today).subtract({ days: 40 }).toString();

  expect(session.orders(from).map(({ orderNo }) => orderNo)).toEqual([
    "x0001",
    "x0001",
    "x0002",
  ]);

  const queries = recordedCalls().filter(
    ([call]) => call === "orderHistory" || call === "getOrderResultsDetail"
  );

  const day = (days: number) =>
    Temporal.PlainDate.from(today)
      .subtract({ days })
      .toString()
      .replaceAll("-", "");

  expect(queries).toEqual([
    ["orderHistory", "28", day(40), day(11)],
    ["orderHistory", "28", day(10), day(1)],
    ["getOrderResultsDetail", "28"],
  ]);
});

test("each sale takes the realized gain Fubon reckoned for it once, and one it has not reckoned none", () => {
  const session = openFubonSession(options("good-key"));

  expect(
    session
      .fills(exchangeDate(Market.TW))
      .map(({ buySell, realized }) => [buySell, realized])
  ).toEqual([
    ["Sell", -203],
    ["Sell", null],
    ["Buy", null],
  ]);
});

test("without Fubon's report of gains, no sale is reckoned", () => {
  const session = openFubonSession(options("no-reports"));

  expect(
    session.fills(exchangeDate(Market.TW)).map(({ realized }) => realized)
  ).toEqual([null, null, null]);
});

test("a bank Fubon cannot read leaves its balance unknown", () => {
  const session = openFubonSession(options("good-key"));

  expect(session.holdings().bank).toBeNull();
});

test("a query Fubon refuses reports its message", () => {
  const session = openFubonSession(options("no-reports"));

  expect(() => session.holdings()).toThrow(
    "Fubon cost query failed: 證券報表/表單定義資料不存在"
  );
});
