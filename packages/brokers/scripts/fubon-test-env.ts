/**
 * Reads a shared account in Fubon's test environment through `./fubon`, printing what the SDK
 * answered beside what the app reads of it, so a change to the module is checked against Fubon
 * itself. The test environment is open 9:30–19:00 Taipei time on weekdays.
 *
 *   vp exec node packages/brokers/scripts/fubon-test-env.ts <sdk folder> <test certificate> [--sell <code> <shares> <price>]
 *
 * The folder is one extracted from fubon-neo-<version>.tgz, and the certificate one from Fubon's
 * test environment package, named for the test account's ID number; its login and certificate
 * password is Fubon's published `12345678`. `--sell` also places a limit sale of what the test
 * account holds through the app's broker, lists it and cancels it.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";

import { OrderRefusedError, orderTag } from "@solyx/core/broker";
import { Market, exchangeDate, exchangeMidnight } from "@solyx/core/market";
import { OrderType, Side } from "@solyx/core/order";
import { errorMessage } from "@solyx/utils/error";

import {
  FUBON_TEST_URL,
  createFubonBroker,
  fubonAccount,
  fubonFill,
  fubonOrder,
  openFubonSession,
} from "../src/fubon.ts";

const TEST_PASSWORD = "12345678";

const [sdkDir, certPath, flag, code, shares, price] = process.argv.slice(2);

if (!sdkDir || !certPath || (flag !== undefined && flag !== "--sell")) {
  throw new Error(
    "Usage: fubon-test-env.ts <sdk folder> <test certificate .pfx> [--sell <code> <shares> <price>]"
  );
}

const show = (title: string, json: string) =>
  console.log(`\n== ${title}\n${json}`);

const pretty = (value: Parameters<typeof JSON.stringify>[0]) =>
  JSON.stringify(value, null, 2);

const session = openFubonSession({
  sdkDir,
  // The SDK logs the account's details where it runs; a test account's go to a folder of their own.
  logDir: mkdtempSync(join(tmpdir(), "solyx-fubon-test-")),
  credentials: {
    personalId: basename(certPath, extname(certPath)),
    password: TEST_PASSWORD,
    certPath,
    certPassword: TEST_PASSWORD,
  },
  url: FUBON_TEST_URL,
});

try {
  const today = exchangeDate(Market.TW);

  show("accounts", pretty(session.accounts));

  const holdings = session.holdings();
  show("holdings as Fubon answered", pretty(holdings));

  const orders = session.orders(today);
  show("today's orders as Fubon answered", pretty(orders));

  const fills = session.fills(today);
  show("today's fills as Fubon answered", pretty(fills));

  const read = {
    orders: orders.flatMap((order) => fubonOrder(order, today) ?? []),
    fills: fills.flatMap((fill) => fubonFill(fill) ?? []),
  };

  show("orders as the app reads them", pretty(read.orders));
  show("fills as the app reads them", pretty(read.fills));
  show(
    "the account as the app reads it",
    pretty(fubonAccount(holdings, read.orders, read.fills, today))
  );

  if (flag === "--sell" && code && shares && price) {
    const broker = createFubonBroker(async () => ({
      holdings: async () => session.holdings(),
      orders: async (from) => session.orders(from),
      fills: async (from) => session.fills(from),
      place: async (order) => session.place(order),
      cancel: async (id) => session.cancel(id),
    }));

    const tag = orderTag(`fubon-test-env-${Date.now()}`);
    const dayStart = exchangeMidnight(Market.TW, today) * 1000;

    try {
      const { orderId } = await broker.placeOrder(
        {
          instrument: { market: Market.TW, symbol: code },
          side: Side.Sell,
          quantity: Number(shares),
          type: OrderType.Limit,
          limitPrice: Number(price),
        },
        tag
      );

      show("placed", pretty({ orderId, tag }));
      show(
        "the day's orders after placing",
        pretty(await broker.getOrders(dayStart))
      );

      await broker.cancelOrder(orderId);
      show(
        "the day's orders after cancelling",
        pretty(await broker.getOrders(dayStart))
      );
    } catch (error) {
      // A refusal says Fubon holds nothing of the order; any other failure leaves it unknown.
      show(
        "placing or cancelling failed",
        pretty({
          refused: error instanceof OrderRefusedError,
          message: errorMessage(error),
        })
      );
    }
  }
} finally {
  session.close();
}
