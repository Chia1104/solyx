import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { chunk } from "es-toolkit";
import * as z from "zod";

import {
  BrokerMode,
  BrokerOrderStatus,
  OrderRefusedError,
} from "@solyx/core/broker";
import type { BrokerAdapter, BrokerOrder } from "@solyx/core/broker";
import { MARKET_TIME_ZONE, Market, exchangeDate } from "@solyx/core/market";
import { OrderType, Side } from "@solyx/core/order";
import type { AccountSnapshot, Fill, OrderRequest } from "@solyx/core/order";
import { twSpendable } from "@solyx/core/rules/tw";
import type { TwTrade } from "@solyx/core/rules/tw";

interface FubonResult<T> {
  isSuccess: boolean;
  data?: T;
  message?: string;
}

export interface FubonAccount {
  name: string;
  branchNo: string;
  account: string;
  accountType: string;
}

/** The slice of the SDK's `Stock` this module calls. */
interface FubonStock {
  getOrderResultsDetail(account: FubonAccount): FubonResult<unknown>;
  orderHistory(
    account: FubonAccount,
    startDate: string,
    endDate: string
  ): FubonResult<unknown>;
  filledHistory(
    account: FubonAccount,
    startDate: string,
    endDate: string
  ): FubonResult<unknown>;
}

/** The slice of the SDK's `Accounting` this module calls. */
interface FubonAccounting {
  inventories(account: FubonAccount): FubonResult<unknown>;
  unrealizedGainsAndLoses(account: FubonAccount): FubonResult<unknown>;
  realizedGainsAndLoses(account: FubonAccount): FubonResult<unknown>;
  bankRemain(account: FubonAccount): FubonResult<unknown>;
  querySettlement(account: FubonAccount, range: string): FubonResult<unknown>;
}

/** The slice of the SDK's native `CoreSdk` this module touches so far. */
interface FubonCoreSdk {
  apikeyLogin(
    personalId: string,
    apiKey: string,
    certPath: string,
    certPassword?: string
  ): FubonResult<FubonAccount[]>;
  login(
    personalId: string,
    password: string,
    certPath: string,
    certPassword?: string
  ): FubonResult<FubonAccount[]>;
  logout(): boolean;
  exchangeRealtimeToken(): string;
  /** Called after the token exchange, which may suggest the endpoint. */
  realtimeWsUrl(mode: "normal" | "speed"): string;
  readonly stock: FubonStock;
  readonly accounting: FubonAccounting;
}

interface FubonBinding {
  CoreSdk: new (
    version: string,
    pongInterval?: number,
    missedPongs?: number,
    url?: string
  ) => FubonCoreSdk;
  FugleRealtime: new () => { readonly realtimeRestUrl: string };
}

// The package's entry needs npm dependencies an extracted download lacks, only to add market
// data clients for Fugle's API, which `@solyx/market-data/fubon` calls directly.
const BINDING = "trade.js";

// What the SDK's own `FubonSDK` passes when it is given an endpoint: seconds between pings, and
// pings missed before the connection counts as lost.
const PONG_INTERVAL = 30;

const MISSED_PONGS = 2;

const manifestSchema = z.object({ version: z.string() });

/**
 * `fubon-neo` is downloaded by each user from Fubon and may not be redistributed, so it is never
 * a package dependency. The user extracts it and chooses that folder or the `package` folder
 * inside it.
 */
function loadFubonSdk(dir: string) {
  const sdkDir = [dir, join(dir, "package")].find((candidate) =>
    existsSync(join(candidate, BINDING))
  );

  if (!sdkDir) {
    throw new Error(
      `No Fubon Neo SDK in ${dir}: choose the folder extracted from fubon-neo-<version>.tgz`
    );
  }

  const { version } = manifestSchema.parse(
    JSON.parse(readFileSync(join(sdkDir, "package.json"), "utf8"))
  );

  // SAFETY: `sdkDir` holds the user's copy of the official `fubon-neo` package, whose native
  // binding exports these classes; a wrong folder fails at login, before any order is placed.
  const binding = createRequire(import.meta.url)(
    join(sdkDir, BINDING)
  ) as FubonBinding;

  return { ...binding, version };
}

interface FubonIdentity {
  /** The ID number the account was opened under. */
  personalId: string;
  /** The certificate exported from Fubon's website; it stays on the user's machine. */
  certPath: string;
  /** @default personalId, which Fubon sets for exported certificates */
  certPassword?: string;
}

export type FubonCredentials = FubonIdentity &
  (
    | {
        /** A key from Fubon's API key page; one limited to market data cannot place orders. */
        apiKey: string;
      }
    | {
        /** The account's own password, which only Fubon's test environment signs in with here. */
        password: string;
      }
  );

export interface FubonSessionOptions {
  sdkDir: string;
  /** Where the SDK writes its logs, which hold the ID number and account details. */
  logDir: string;
  credentials: FubonCredentials;
  /** The endpoint the SDK connects to, such as Fubon's test environment's; Fubon's own unless set. */
  url?: string;
}

/** Fubon's test environment, where shared test accounts trade nothing real. */
export const FUBON_TEST_URL = "wss://neoapitest.fbs.com.tw/TASP/XCPXWS";

/** A market data token and the endpoints that take it; the stream is Normal mode's, the one with candles. */
export interface FubonRealtime {
  sdkToken: string;
  /** Host and path prefix, as the SDK reports them. */
  restBaseUrl: string;
  streamBaseUrl: string;
}

const optionalNumber = z.number().nullish();

const optionalText = z.string().nullish();

// Board and odd lots are counted apart: an odd-lot sale moves a lot from one to the other.
const inventorySchema = z.object({
  stockNo: z.string(),
  orderType: z.string(),
  todayQty: z.number(),
  /** What working sales leave to sell. */
  tradableQty: z.number(),
  odd: z.object({ todayQty: z.number(), tradableQty: z.number() }).nullish(),
});

const unrealizedSchema = z.object({
  stockNo: z.string(),
  orderType: z.string(),
  costPrice: z.number(),
});

const bankSchema = z.object({ availableBalance: z.number() });

const settlementSchema = z.object({
  date: z.string(),
  settlementDate: optionalText,
  totalSettlementAmount: optionalNumber,
});

const settlementsSchema = z.object({
  details: z.array(settlementSchema).nullish(),
});

const orderResultSchema = z.object({
  date: z.string(),
  seqNo: z.string(),
  orderNo: optionalText,
  stockNo: optionalText,
  buySell: optionalText,
  priceType: optionalText,
  price: optionalNumber,
  afterPrice: optionalNumber,
  quantity: optionalNumber,
  /** What the order stands for now, its fills included; a change of quantity changes it. */
  afterQty: optionalNumber,
  filledQty: optionalNumber,
  orderType: optionalText,
  status: optionalNumber,
  userDef: optionalText,
  lastTime: z.string(),
  details: z.array(z.object({ modifiedTime: z.string() })).nullish(),
});

const filledSchema = z.object({
  date: z.string(),
  orderNo: z.string(),
  stockNo: z.string(),
  buySell: z.string(),
  orderType: z.string(),
  filledQty: z.number(),
  filledPrice: z.number(),
  filledTime: z.string(),
});

const realizedSchema = z.object({
  date: z.string(),
  stockNo: z.string(),
  buySell: z.string(),
  orderType: z.string(),
  filledQty: z.number(),
  filledPrice: z.number(),
  realizedProfit: z.number(),
  realizedLoss: z.number(),
});

/** What the stock account holds and owes, as Fubon reports it. */
export interface FubonHoldings {
  inventories: z.infer<typeof inventorySchema>[];
  unrealized: z.infer<typeof unrealizedSchema>[];
  /** `null` where Fubon cannot read the settlement bank's balance, as for any bank but its own and LINE Bank. */
  bank: z.infer<typeof bankSchema> | null;
  settlements: z.infer<typeof settlementSchema>[];
}

export type FubonOrder = z.infer<typeof orderResultSchema>;

/** A fill as Fubon reports it, with what its sale realized where Fubon reckoned it. */
export interface FubonFill extends z.infer<typeof filledSchema> {
  realized: number | null;
}

export interface FubonSession {
  accounts: FubonAccount[];
  /** Exchanges the session for a market data token. */
  realtime(): FubonRealtime;
  /** What the stock account holds and owes now. */
  holdings(): FubonHoldings;
  /** The stock account's orders placed from `from`, an exchange-local day, through today. */
  orders(from: string): FubonOrder[];
  /** The stock account's fills from `from`, an exchange-local day, through today. */
  fills(from: string): FubonFill[];
  close(): void;
}

// Fubon answers at most five account queries a second.
const ACCOUNT_QUERIES_PER_SECOND = 5;

// Fubon reads at most 30 days of history at once.
const HISTORY_SPAN_DAYS = 30;

/** How far back the app reads Fubon's orders and fills, which costs a query per 30 days. */
export const FUBON_HISTORY_DAYS = 90;

const pause = new Int32Array(new SharedArrayBuffer(4));

/** Spaces calls to at most `perSecond`, waiting in place, since the SDK's own calls block too. */
function pacer(perSecond: number) {
  const recent: number[] = [];

  return () => {
    const now = Date.now();

    while (recent.length > 0 && (recent[0] ?? now) <= now - 1000) {
      recent.shift();
    }

    if (recent.length >= perSecond) {
      Atomics.wait(pause, 0, 0, (recent[0] ?? now) + 1000 - now);
    }

    recent.push(Date.now());
  };
}

function answer<T>(
  what: string,
  result: FubonResult<unknown>,
  schema: z.ZodType<T>
): T {
  if (!result.isSuccess) {
    throw new Error(`Fubon ${what} failed: ${result.message ?? "no reason"}`);
  }

  const parsed = schema.safeParse(result.data ?? null);

  if (!parsed.success) {
    throw new Error(
      `Fubon ${what} answered in a shape Solyx does not read: ${z.prettifyError(parsed.error)}`
    );
  }

  return parsed.data;
}

/** `20261019`, as Fubon's queries take a day, from an exchange-local `2026-10-19`. */
const fubonDay = (date: string) => date.replaceAll("-", "");

/** The exchange-local `2026-10-19` from Fubon's `2026/10/19`. */
const isoDay = (date: string) => date.replaceAll("/", "-");

/** The days from `from` through `to`, in spans Fubon reads at once. */
function historySpans(from: string, to: string): [string, string][] {
  const days: string[] = [];

  for (
    let day = Temporal.PlainDate.from(from);
    Temporal.PlainDate.compare(day, to) <= 0;
    day = day.add({ days: 1 })
  ) {
    days.push(day.toString());
  }

  return chunk(days, HISTORY_SPAN_DAYS).map((span) => [
    span[0] ?? from,
    span.at(-1) ?? to,
  ]);
}

/**
 * Signs in with an API key, or a password where the options name Fubon's test environment. The
 * SDK's calls are synchronous and block until Fubon answers, it connects to Fubon as soon as it is
 * created, and it moves the process to `logDir`, so callers run it in a process of its own.
 */
export function openFubonSession(options: FubonSessionOptions): FubonSession {
  const { CoreSdk, FugleRealtime, version } = loadFubonSdk(options.sdkDir);

  // The SDK logs to `./log` and has no setting for it, so the process works from `logDir`.
  mkdirSync(options.logDir, { recursive: true });
  process.chdir(options.logDir);

  const sdk =
    options.url === undefined
      ? new CoreSdk(version)
      : new CoreSdk(version, PONG_INTERVAL, MISSED_PONGS, options.url);

  const { credentials } = options;
  const { personalId, certPath, certPassword } = credentials;

  const result =
    "apiKey" in credentials
      ? sdk.apikeyLogin(personalId, credentials.apiKey, certPath, certPassword)
      : sdk.login(personalId, credentials.password, certPath, certPassword);

  if (!result.isSuccess || !result.data?.length) {
    throw new Error(`Fubon login failed: ${result.message ?? "no accounts"}`);
  }

  const accounts = result.data;
  const paceQuery = pacer(ACCOUNT_QUERIES_PER_SECOND);

  function stockAccount(): FubonAccount {
    const account = accounts.find(({ accountType }) => accountType === "stock");

    if (!account) throw new Error("Fubon lists no stock account to trade");

    return account;
  }

  function query<T>(
    what: string,
    call: (account: FubonAccount) => FubonResult<unknown>,
    schema: z.ZodType<T>
  ): T {
    paceQuery();

    return answer(what, call(stockAccount()), schema);
  }

  /** As `query`, but `null` where Fubon answers that it cannot, for what the app can do without. */
  function attempt<T>(
    what: string,
    call: (account: FubonAccount) => FubonResult<unknown>,
    schema: z.ZodType<T>
  ): T | null {
    paceQuery();

    const result = call(stockAccount());

    return result.isSuccess ? answer(what, result, schema) : null;
  }

  const today = () => exchangeDate(Market.TW);

  function orders(from: string): FubonOrder[] {
    const { stock } = sdk;
    const yesterday = Temporal.PlainDate.from(today()).subtract({ days: 1 });

    const past =
      Temporal.PlainDate.compare(from, yesterday) <= 0
        ? historySpans(from, yesterday.toString()).flatMap(
            ([start, end]) =>
              query(
                "order history",
                (account) =>
                  stock.orderHistory(account, fubonDay(start), fubonDay(end)),
                z.array(orderResultSchema).nullable()
              ) ?? []
          )
        : [];

    return [
      ...past,
      ...(query(
        "order query",
        (account) => stock.getOrderResultsDetail(account),
        z.array(orderResultSchema).nullable()
      ) ?? []),
    ];
  }

  return {
    accounts,

    realtime() {
      const sdkToken = sdk.exchangeRealtimeToken();

      return {
        sdkToken,
        restBaseUrl: new FugleRealtime().realtimeRestUrl,
        streamBaseUrl: sdk.realtimeWsUrl("normal"),
      };
    },

    holdings() {
      const { accounting } = sdk;

      return {
        inventories:
          query(
            "inventory query",
            (account) => accounting.inventories(account),
            z.array(inventorySchema).nullable()
          ) ?? [],
        unrealized:
          query(
            "cost query",
            (account) => accounting.unrealizedGainsAndLoses(account),
            z.array(unrealizedSchema).nullable()
          ) ?? [],
        bank: attempt(
          "bank balance query",
          (account) => accounting.bankRemain(account),
          bankSchema
        ),
        settlements:
          query(
            "settlement query",
            (account) => accounting.querySettlement(account, "3d"),
            settlementsSchema
          ).details ?? [],
      };
    },

    orders,

    fills(from) {
      const { stock, accounting } = sdk;

      const fills = historySpans(from, today()).flatMap(
        ([start, end]) =>
          query(
            "fill query",
            (account) =>
              stock.filledHistory(account, fubonDay(start), fubonDay(end)),
            z.array(filledSchema).nullable()
          ) ?? []
      );

      // Without Fubon's report of gains, as in its test environment, no sale is reckoned.
      const realized =
        attempt(
          "realized gain query",
          (account) => accounting.realizedGainsAndLoses(account),
          z.array(realizedSchema).nullable()
        ) ?? [];

      return fills.map((fill) => {
        // Fubon reckons each sale apart; one it has not yet reckoned has no row.
        const row = realized.find(
          (each) =>
            each.date === fill.date &&
            each.stockNo === fill.stockNo &&
            each.buySell === fill.buySell &&
            each.orderType === fill.orderType &&
            each.filledQty === fill.filledQty &&
            each.filledPrice === fill.filledPrice
        );

        if (row) realized.splice(realized.indexOf(row), 1);

        return {
          ...fill,
          realized: row ? row.realizedProfit - row.realizedLoss : null,
        };
      });
    },

    close() {
      sdk.logout();
    },
  };
}

/** The UTC milliseconds of an exchange-local Fubon day and time, `2026/10/19` and `09:01:02.345`. */
function fubonTime(date: string, time: string): number {
  return Temporal.PlainDateTime.from(`${isoDay(date)}T${time}`)
    .toZonedDateTime(MARKET_TIME_ZONE[Market.TW])
    .toInstant().epochMilliseconds;
}

const FUBON_SIDE = new Map<string, Side>([
  ["Buy", Side.Buy],
  ["Sell", Side.Sell],
]);

// Cash orders alone: the app's orders neither borrow nor lend shares.
const CASH_ORDER = "Stock";

/** An order's id: Fubon numbers orders (`orderNo`) afresh each day. */
const fubonOrderId = (date: string, orderNo: string) =>
  `${isoDay(date)}:${orderNo}`;

const FUBON_STATUS = new Map<number, BrokerOrderStatus>([
  [0, BrokerOrderStatus.Pending],
  [4, BrokerOrderStatus.Pending],
  [8, BrokerOrderStatus.Pending],
  // Fubon lost the line to the exchange and has yet to learn what became of the order.
  [9, BrokerOrderStatus.Pending],
  [10, BrokerOrderStatus.Working],
  [30, BrokerOrderStatus.Cancelled],
  [40, BrokerOrderStatus.Cancelled],
  [50, BrokerOrderStatus.Filled],
  [90, BrokerOrderStatus.Refused],
]);

/**
 * An order as the app reads one, or `null` for one it cannot say, such as a margin order or one
 * Fubon has yet to number. An order of an earlier day still on the book was left at its close.
 */
export function fubonOrder(
  result: FubonOrder,
  today: string
): BrokerOrder | null {
  const side = FUBON_SIDE.get(result.buySell ?? "");
  // Fubon lists an order it has yet to number with a blank number.
  const orderNo = result.orderNo?.trim();
  const { stockNo } = result;
  // What the order stands for now, so one cut down reads at its new size; one nothing of which
  // stands, as once cancelled, at what it asked for.
  const quantity = result.afterQty || result.quantity;

  if (
    !side ||
    !orderNo ||
    !stockNo ||
    !quantity ||
    result.orderType !== CASH_ORDER
  ) {
    return null;
  }

  const instrument = { market: Market.TW, symbol: stockNo };
  // A price Fubon set itself, as for limit-up, is what the order works at.
  const limitPrice = result.afterPrice ?? result.price;

  const order: OrderRequest =
    result.priceType === "Market" ||
    limitPrice === null ||
    limitPrice === undefined
      ? { instrument, side, quantity, type: OrderType.Market }
      : { instrument, side, quantity, type: OrderType.Limit, limitPrice };

  const reported =
    FUBON_STATUS.get(result.status ?? -1) ?? BrokerOrderStatus.Pending;

  const open =
    reported === BrokerOrderStatus.Pending ||
    reported === BrokerOrderStatus.Working;

  return {
    id: fubonOrderId(result.date, orderNo),
    tag: result.userDef?.trim() || null,
    order,
    // Fubon's history leaves out what filled, so an order it lists as filled filled whole.
    filled:
      result.filledQty ??
      (reported === BrokerOrderStatus.Filled ? quantity : 0),
    status:
      open && isoDay(result.date) < today
        ? BrokerOrderStatus.Cancelled
        : reported,
    placedAt: fubonTime(
      result.date,
      result.details?.[0]?.modifiedTime ?? result.lastTime
    ),
  };
}

/** A fill as the app reads one, or `null` for one of an order it cannot say. */
export function fubonFill(fill: FubonFill): Fill | null {
  const side = FUBON_SIDE.get(fill.buySell);

  if (!side || fill.orderType !== CASH_ORDER) return null;

  return {
    orderId: fubonOrderId(fill.date, fill.orderNo),
    instrument: { market: Market.TW, symbol: fill.stockNo },
    side,
    quantity: fill.filledQty,
    price: fill.filledPrice,
    filledAt: fubonTime(fill.date, fill.filledTime),
    realized: side === Side.Sell ? fill.realized : null,
  };
}

/**
 * The account as the app reads it: the shares it holds outright at what they cost, and what it
 * can spend on buys, its settlement bank's balance with every trade not yet settled against it
 * (`twSpendable`), unknown where Fubon cannot read the bank. On a settlement day the bank may or
 * may not have taken that day's trades yet, so only what they take out is counted, which errs low.
 */
export function fubonAccount(
  { inventories, unrealized, bank, settlements }: FubonHoldings,
  orders: readonly BrokerOrder[],
  fills: readonly Fill[],
  today: string
): AccountSnapshot {
  const positions = inventories.flatMap(
    ({ stockNo, orderType, todayQty, tradableQty, odd }) => {
      const quantity = todayQty + (odd?.todayQty ?? 0);

      if (orderType !== CASH_ORDER || quantity <= 0) return [];

      const cost = unrealized.find(
        (row) => row.stockNo === stockNo && row.orderType === CASH_ORDER
      );

      return [
        {
          instrument: { market: Market.TW, symbol: stockNo },
          quantity,
          avgPrice: cost?.costPrice ?? 0,
          sellable: tradableQty + (odd?.tradableQty ?? 0),
        },
      ];
    }
  );

  const unsettled = settlements.flatMap(
    ({ date, settlementDate, totalSettlementAmount }) => {
      const amount = totalSettlementAmount ?? 0;
      const settles = settlementDate ? isoDay(settlementDate) : null;

      if (isoDay(date) >= today || settles === null || settles < today) {
        return [];
      }

      return [settles === today ? Math.min(0, amount) : amount];
    }
  );

  const traded: TwTrade[] = fills
    .filter(
      ({ filledAt }) => exchangeDate(Market.TW, new Date(filledAt)) === today
    )
    .map(({ instrument, side, quantity, price }) => ({
      symbol: instrument.symbol,
      side,
      quantity,
      price,
    }));

  // What a buy still on the book may yet spend; a market order's price is not known.
  const booked: TwTrade[] = orders.flatMap(({ order, filled, status }) =>
    order.side === Side.Buy &&
    order.type === OrderType.Limit &&
    (status === BrokerOrderStatus.Pending ||
      status === BrokerOrderStatus.Working)
      ? [
          {
            symbol: order.instrument.symbol,
            side: Side.Buy,
            quantity: order.quantity - filled,
            price: order.limitPrice,
          },
        ]
      : []
  );

  return {
    cash: {
      TWD:
        bank === null
          ? null
          : twSpendable(bank.availableBalance, unsettled, [
              ...traded,
              ...booked,
            ]),
    },
    positions,
  };
}

/** The calls a Fubon broker makes of the session, which lives in a process of its own. */
export interface FubonReader {
  holdings(): Promise<FubonHoldings>;
  orders(from: string): Promise<FubonOrder[]>;
  fills(from: string): Promise<FubonFill[]>;
}

/**
 * Fubon's stock account, read through `reader`. It never signs in itself: the SDK runs only in a
 * process of its own, and market data and trading share one sign-in, since repeated sign-ins could
 * lock the account.
 */
export function createFubonBroker(reader: FubonReader): BrokerAdapter {
  const today = () => exchangeDate(Market.TW);

  async function orders(from: string) {
    const day = today();

    return (await reader.orders(from)).flatMap((result) => {
      const order = fubonOrder(result, day);

      return order ? [order] : [];
    });
  }

  async function fills(from: string) {
    return (await reader.fills(from)).flatMap((fill) => {
      const read = fubonFill(fill);

      return read ? [read] : [];
    });
  }

  // History older than Fubon's span is not read, so `since` reaches back that far at most.
  function dayOf(since: number) {
    const earliest = Temporal.PlainDate.from(today())
      .subtract({ days: FUBON_HISTORY_DAYS })
      .toString();

    const day = exchangeDate(Market.TW, new Date(since));

    return day < earliest ? earliest : day;
  }

  return {
    id: "fubon",
    mode: BrokerMode.Live,
    markets: [Market.TW],

    async getAccount() {
      const day = today();

      const [holdings, booked, filled] = await Promise.all([
        reader.holdings(),
        orders(day),
        fills(day),
      ]);

      return fubonAccount(holdings, booked, filled, day);
    },

    async getFills(since) {
      return (await fills(dayOf(since))).filter(
        ({ filledAt }) => filledAt >= since
      );
    },

    async getOrders(since) {
      return (await orders(dayOf(since))).filter(
        ({ placedAt }) => placedAt >= since
      );
    },

    async placeOrder() {
      throw new OrderRefusedError("Solyx does not place orders with Fubon yet");
    },
  };
}
