/**
 * Checks `./fubon` against a `fubon-neo` download in Fubon's shared test environment, failing
 * where the module no longer reads what the SDK answers: the sign-in's stock account, the day's
 * orders and fills, the inventory, and a buy at the day's lower limit placed through the app's
 * broker, listed under its tag, cancelled and reported, then one below that limit refused. The
 * Fubon SDK workflow runs it on the version Fubon offers. The test environment is open 9:30–19:00
 * Taipei time on weekdays.
 *
 *   vp exec node packages/brokers/scripts/fubon-sdk-check.ts <sdk folder> <test certificate>
 *
 * The certificate is one from Fubon's test environment package, named for the test account's ID
 * number; its login and certificate password is Fubon's published `12345678`.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  BrokerOrderStatus,
  OrderRefusedError,
  orderTag,
} from "@solyx/core/broker";
import { Market, exchangeDate, exchangeMidnight } from "@solyx/core/market";
import { OrderType, Side } from "@solyx/core/order";
import type { OrderRequest } from "@solyx/core/order";
import { errorMessage } from "@solyx/utils/error";

import {
  FUBON_TEST_URL,
  createFubonBroker,
  fubonFill,
  fubonOrder,
  fubonStockAccounts,
  openFubonSession,
} from "../src/fubon.ts";

const TEST_PASSWORD = "12345678";

// A listing the test environment always quotes; its prices there are its own, not the market's.
const SYMBOL = "2881";

// Fubon reports an order placed and cancelled twice and a refused one once, once the SDK's calls
// no longer hold the process.
const REPORTS_EXPECTED = 3;

const REPORTS_WAIT_MS = 3000;

const [sdkDir, certPath] = process.argv.slice(2);

if (!sdkDir || !certPath) {
  throw new Error(
    "Usage: fubon-sdk-check.ts <sdk folder> <test certificate .pfx>"
  );
}

const failures: string[] = [];

/** Runs one check and prints how it went, so one failure hides none of the rest. */
async function check(name: string, run: () => void | Promise<void>) {
  try {
    await run();
    console.log(`ok    ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`fail  ${name}: ${errorMessage(error)}`);
  }
}

const session = openFubonSession({
  sdkDir,
  // The SDK logs the account's details where it runs; a test account's go to a folder of their own.
  logDir: mkdtempSync(join(tmpdir(), "solyx-fubon-check-")),
  credentials: {
    personalId: basename(certPath, extname(certPath)),
    password: TEST_PASSWORD,
    certPath,
    certPassword: TEST_PASSWORD,
  },
  url: FUBON_TEST_URL,
});

console.log("ok    signs in to the test environment");

try {
  const [stock] = fubonStockAccounts(session.accounts);

  assert.ok(stock, "The test sign-in lists no stock account");

  const account = stock.id;
  const today = exchangeDate(Market.TW);

  await check("reads today's orders", () => {
    for (const order of session.orders(account, today))
      fubonOrder(order, today);
  });

  await check("reads today's fills", () => {
    for (const fill of session.fills(account, today)) fubonFill(fill);
  });

  await check("reads the inventory", () => {
    try {
      session.holdings(account);
    } catch (error) {
      // The test environment keeps no reports of costs, read after the inventory, so only that may fail.
      if (!errorMessage(error).startsWith("Fubon cost query failed")) {
        throw error;
      }
    }
  });

  const broker = createFubonBroker({
    session: async () => ({
      holdings: async (id) => session.holdings(id),
      orders: async (id, from) => session.orders(id, from),
      fills: async (id, from) => session.fills(id, from),
      place: async (id, order) => session.place(id, order),
      cancel: async (id, orderId) => session.cancel(id, orderId),
    }),
    account,
  });

  const buy = (limitPrice: number): OrderRequest => ({
    instrument: { market: Market.TW, symbol: SYMBOL },
    side: Side.Buy,
    quantity: 1000,
    type: OrderType.Limit,
    limitPrice,
  });

  const dayStart = exchangeMidnight(Market.TW, today) * 1000;

  // Others trade the shared account too, so the count can only come out higher.
  let reports = 0;

  session.onChange(() => {
    reports += 1;
  });

  await check(
    "places a buy, lists it under its tag and cancels it",
    async () => {
      const { down } = session.priceLimits(account, SYMBOL);
      const tag = orderTag(`fubon-sdk-check-${Date.now()}`);
      const { orderId } = await broker.placeOrder(buy(down), tag);

      const listed = async () =>
        (await broker.getOrders(dayStart)).find((order) => order.tag === tag)
          ?.status;

      assert.equal(await listed(), BrokerOrderStatus.Working);
      await broker.cancelOrder(orderId);
      assert.equal(await listed(), BrokerOrderStatus.Cancelled);
    }
  );

  await check("refuses a buy below the day's limit", async () => {
    const { down } = session.priceLimits(account, SYMBOL);

    await assert.rejects(
      broker.placeOrder(
        buy(Math.floor(down) - 1),
        orderTag(`fubon-sdk-check-refused-${Date.now()}`)
      ),
      OrderRefusedError
    );
  });

  await sleep(REPORTS_WAIT_MS);

  await check("hears Fubon's reports of the orders", () => {
    assert.ok(
      reports >= REPORTS_EXPECTED,
      `${reports} reports, not ${REPORTS_EXPECTED}`
    );
  });
} finally {
  session.close();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} failed: ${failures.join("; ")}`);
  process.exitCode = 1;
}
