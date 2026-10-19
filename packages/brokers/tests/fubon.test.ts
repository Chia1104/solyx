import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";
import * as z from "zod";

import { BrokerOrderStatus } from "@solyx/core/broker";
import { OrderRefusedError } from "@solyx/core/broker";
import { Market, exchangeDate } from "@solyx/core/market";
import { OrderType, Side } from "@solyx/core/order";
import type { Fill } from "@solyx/core/order";

import {
  FUBON_TEST_URL,
  createFubonBroker,
  fubonAccount,
  fubonFill,
  fubonOrder,
  fubonOrderObject,
  fubonStockAccounts,
  openFubonSession,
} from "../src/fubon.ts";
import type { FubonFill, FubonHoldings, FubonOrder } from "../src/fubon.ts";

// Stands in for the SDK's native binding; it records calls on the module so tests can read them.
const FAKE_BINDING = `
const calls = [];

const reports = {};

const NO_REPORT = "證券報表/表單定義資料不存在";

const REFUSED = "單價輸入錯誤[4385715]";

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
      placeOrder(account, order, unblock) {
        calls.push(["placeOrder", account.account, order, unblock]);

        if (order.symbol === "9999") return { isSuccess: false, message: "connection lost" };

        if (order.symbol === "8888") return { isSuccess: false, message: REFUSED };

        return { isSuccess: true, data: { date: "2026/10/19", seqNo: "3", orderNo: "x0003", status: 10, userDef: order.userDef, lastTime: "09:00:00.000" } };
      },
      getOrderResults(account) {
        calls.push(["getOrderResults", account.account]);

        return { isSuccess: true, data: [{ date: "2026/10/19", seqNo: "2", orderNo: "x0002", lastTime: "09:00:00.000", isPreOrder: false }, { date: "2026/10/19", seqNo: "4", stockNo: "8888", buySell: "Buy", status: 90, userDef: "A1B2C3", errorMessage: REFUSED, lastTime: "09:00:00.000", isPreOrder: false }] };
      },
      cancelOrder(account, order, unblock) {
        calls.push(["cancelOrder", account.account, order, unblock]);

        return order.orderNo === "x0002"
          ? { isSuccess: true, data: { ...order, status: 30 } }
          : { isSuccess: false, message: "not found" };
      },
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

  innerSetOnOrder(callback) {
    reports.order = callback;
  }

  innerSetOnOrderChanged(callback) {
    reports.changed = callback;
  }

  setOnFilled(callback) {
    reports.filled = callback;
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

// Fubon telling of an order being placed, changed and filled, each through its own callback.
function report() {
  reports.order?.(null, { isSuccess: true });
  reports.changed?.(null, { isSuccess: true });
  reports.filled?.(null, {});
}

module.exports = { CoreSdk, FugleRealtime, calls, report };
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
/** Has the fake SDK tell of an order being placed, changed and filled. */
function report() {
  z.object({ report: z.custom<() => void>() })
    .parse(
      createRequire(import.meta.url)(join(directory, "package", "trade.js"))
    )
    .report();
}

function recordedCalls() {
  return z
    .object({ calls: z.array(z.array(z.unknown())) })
    .parse(
      createRequire(import.meta.url)(join(directory, "package", "trade.js"))
    ).calls;
}

// The stock accounts the fake SDK lists for the "good-key" and "no-reports" sign-ins.
const ACCOUNT = "6460-28";

const UNREPORTED_ACCOUNT = "6460-29";

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

  test("an order reads at what it stands for now, and one filled in Fubon's history as filled whole", () => {
    // Cut from 3,000 shares to 2,000, of which 1,000 filled.
    expect(
      fubonOrder(
        orderResult({ quantity: 3000, afterQty: 2000, filledQty: 1000 }),
        "2026-10-19"
      )
    ).toMatchObject({ order: { quantity: 2000 }, filled: 1000 });

    // Cancelled: nothing of it stands.
    expect(
      fubonOrder(orderResult({ afterQty: 0, status: 30 }), "2026-10-19")?.order
    ).toMatchObject({ quantity: 2000 });

    expect(
      fubonOrder(
        orderResult({
          date: "2026/10/07",
          quantity: 3000,
          afterQty: 1000,
          filledQty: undefined,
          status: 50,
        }),
        "2026-10-19"
      )
    ).toMatchObject({
      order: { quantity: 1000 },
      filled: 1000,
      status: BrokerOrderStatus.Filled,
    });
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
        // A working sale holds back a lot and 100 odd shares.
        tradableQty: 1000,
        odd: { todayQty: 300, tradableQty: 200 },
      },
      {
        stockNo: "2330",
        orderType: "Margin",
        todayQty: 1000,
        tradableQty: 1000,
        odd: { todayQty: 0, tradableQty: 0 },
      },
      {
        stockNo: "0050",
        orderType: "Stock",
        todayQty: 0,
        tradableQty: 0,
        odd: { todayQty: 0, tradableQty: 0 },
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
      sellable: 1200,
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

  expect(session.orders(ACCOUNT, from).map(({ orderNo }) => orderNo)).toEqual([
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
      .fills(ACCOUNT, exchangeDate(Market.TW))
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
    session
      .fills(UNREPORTED_ACCOUNT, exchangeDate(Market.TW))
      .map(({ realized }) => realized)
  ).toEqual([null, null, null]);
});

test("tells its listener of each order Fubon reports placed, changed or filled", () => {
  const session = openFubonSession(options("good-key"));
  const listener = vi.fn();

  session.onChange(listener);
  report();

  expect(listener).toHaveBeenCalledTimes(3);
});

test("a bank Fubon cannot read leaves its balance unknown", () => {
  const session = openFubonSession(options("good-key"));

  expect(session.holdings(ACCOUNT).bank).toBeNull();
});

test("a query Fubon refuses reports its message", () => {
  const session = openFubonSession(options("no-reports"));

  expect(() => session.holdings(UNREPORTED_ACCOUNT)).toThrow(
    "Fubon cost query failed: 證券報表/表單定義資料不存在"
  );
});

test("each call names its stock account, and one the sign-in does not list is refused", () => {
  const session = openFubonSession(options("good-key"));

  expect(fubonStockAccounts(session.accounts)).toEqual([
    { id: ACCOUNT, name: "Test" },
  ]);
  expect(() => session.holdings("6460-29")).toThrow(
    "Fubon lists no stock account 6460-29 for this sign-in"
  );
});

const tsmc = { market: Market.TW, symbol: "2330" };

describe("an order as Fubon takes it", () => {
  test("whole lots go to the regular book at their limit, marked with the tag", () => {
    expect(
      fubonOrderObject(
        {
          instrument: tsmc,
          side: Side.Buy,
          quantity: 2000,
          type: OrderType.Limit,
          limitPrice: 1005,
        },
        "A1B2C3"
      )
    ).toEqual({
      buySell: "Buy",
      symbol: "2330",
      quantity: 2000,
      marketType: "Common",
      priceType: "Limit",
      price: "1005",
      timeInForce: "ROD",
      orderType: "Stock",
      userDef: "A1B2C3",
    });
  });

  test("an odd lot goes to the intraday odd-lot book, and a market order takes no price", () => {
    expect(
      fubonOrderObject(
        {
          instrument: tsmc,
          side: Side.Sell,
          quantity: 300,
          type: OrderType.Limit,
          limitPrice: 1005,
        },
        "A1B2C3"
      )
    ).toMatchObject({ buySell: "Sell", marketType: "IntradayOdd" });

    const market = fubonOrderObject(
      {
        instrument: tsmc,
        side: Side.Buy,
        quantity: 1000,
        type: OrderType.Market,
      },
      "A1B2C3"
    );

    expect(market).toMatchObject({ priceType: "Market" });
    expect(market).not.toHaveProperty("price");
  });

  test("a tag reads back as Fubon kept it, and a blank one as none", () => {
    expect(
      fubonOrder(orderResult({ userDef: "A1B2C3" }), "2026-10-19")?.tag
    ).toBe("A1B2C3");
    expect(
      fubonOrder(orderResult({ userDef: " " }), "2026-10-19")?.tag
    ).toBeNull();
  });
});

describe("placing through the session", () => {
  const order = (symbol: string) =>
    fubonOrderObject(
      {
        instrument: { market: Market.TW, symbol },
        side: Side.Buy,
        quantity: 1000,
        type: OrderType.Limit,
        limitPrice: 66,
      },
      "A1B2C3"
    );

  test("answers with the order Fubon gave back, or the failed one it lists under the tag", () => {
    const session = openFubonSession(options("good-key"));

    expect(session.place(ACCOUNT, order("2881"))).toMatchObject({
      orderNo: "x0003",
      status: 10,
    });
    expect(session.place(ACCOUNT, order("8888"))).toMatchObject({
      seqNo: "4",
      status: 90,
      errorMessage: "單價輸入錯誤[4385715]",
    });
    expect(recordedCalls().find(([call]) => call === "placeOrder")).toEqual([
      "placeOrder",
      "28",
      order("2881"),
      false,
    ]);
  });

  test("throws where Fubon gave no order back and lists none under the tag, which leaves the outcome unknown", () => {
    const session = openFubonSession(options("good-key"));

    expect(() => session.place(ACCOUNT, order("9999"))).toThrow(
      "Fubon gave no order back: connection lost"
    );
  });

  test("cancels today's order by handing back the order as Fubon listed it", () => {
    const session = openFubonSession(options("good-key"));

    session.cancel(ACCOUNT, "2026-10-19:x0002");

    expect(recordedCalls().find(([call]) => call === "cancelOrder")).toEqual([
      "cancelOrder",
      "28",
      {
        date: "2026/10/19",
        seqNo: "2",
        orderNo: "x0002",
        lastTime: "09:00:00.000",
        isPreOrder: false,
      },
      false,
    ]);
    expect(() => session.cancel(ACCOUNT, "2026-10-19:x9999")).toThrow(
      "Fubon lists no order 2026-10-19:x9999 today to cancel"
    );
  });
});

describe("a Fubon broker placing an order", () => {
  const limit = {
    instrument: tsmc,
    side: Side.Buy,
    quantity: 1000,
    type: OrderType.Limit,
    limitPrice: 1005,
  } as const;

  const broker = (placed: FubonOrder, account: string | null = ACCOUNT) =>
    createFubonBroker({
      session: async () => ({
        holdings: async () => ({
          inventories: [],
          unrealized: [],
          bank: { availableBalance: 0 },
          settlements: [],
        }),
        orders: async () => [],
        fills: async () => [],
        place: async () => placed,
        cancel: async () => undefined,
      }),
      account,
    });

  test("is named for the account it trades, and trades none until one is picked", async () => {
    expect(broker(orderResult()).id).toBe(`fubon:${ACCOUNT}`);

    const unpicked = broker(orderResult(), null);

    await expect(unpicked.getAccount()).rejects.toThrow(
      "Choose the Fubon account orders go to in Settings → Trading"
    );
    await expect(unpicked.placeOrder(limit, "A1B2C3")).rejects.toThrow(
      "Choose the Fubon account"
    );
  });

  test("answers with Fubon's day and number for it", async () => {
    await expect(
      broker(orderResult()).placeOrder(limit, "A1B2C3")
    ).resolves.toEqual({ orderId: "2026-10-19:bA627" });
  });

  test("is refused where Fubon failed it, so nothing of it is held", async () => {
    await expect(
      broker(
        orderResult({ status: 90, errorMessage: "insufficient quota" })
      ).placeOrder(limit, "A1B2C3")
    ).rejects.toThrow(
      new OrderRefusedError("Fubon refused the order: insufficient quota")
    );
  });

  test("leaves the outcome unknown where Fubon has yet to number it", async () => {
    const placing = broker(
      orderResult({ orderNo: null, status: 4 })
    ).placeOrder(limit, "A1B2C3");

    await expect(placing).rejects.toThrow("has yet to number it");
    await expect(placing).rejects.not.toBeInstanceOf(OrderRefusedError);
  });
});
