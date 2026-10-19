/**
 * Reads a shared account in Fubon's test environment through `./fubon`, printing what the SDK
 * answered beside what the app reads of it, so a change to the module is checked against Fubon
 * itself. The test environment is open 9:30–19:00 Taipei time on weekdays.
 *
 *   vp exec node packages/brokers/scripts/fubon-test-env.ts <sdk folder> <test certificate>
 *
 * The folder is one extracted from fubon-neo-<version>.tgz, and the certificate one from Fubon's
 * test environment package, named for the test account's ID number; its login and certificate
 * password is Fubon's published `12345678`.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";

import { Market, exchangeDate } from "@solyx/core/market";
import { errorMessage } from "@solyx/utils/error";

import {
  FUBON_TEST_URL,
  fubonAccount,
  fubonFill,
  fubonOrder,
  openFubonSession,
} from "../src/fubon.ts";

const TEST_PASSWORD = "12345678";

const [sdkDir, certPath] = process.argv.slice(2);

if (!sdkDir || !certPath) {
  throw new Error(
    "Usage: fubon-test-env.ts <sdk folder> <test certificate .pfx>"
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

/** Runs one read and prints what it gave, or why it failed, so one failure hides none of the rest. */
function step<T>(title: string, read: () => T): T | null {
  try {
    const value = read();

    show(title, pretty(value));

    return value;
  } catch (error) {
    show(`${title} failed`, errorMessage(error));

    return null;
  }
}

try {
  const today = exchangeDate(Market.TW);

  show("accounts", pretty(session.accounts));

  // The test environment keeps no reports of costs or gains, so this fails there.
  const holdings = step("holdings as Fubon answered", () => session.holdings());

  const orders =
    step("today's orders as Fubon answered", () => session.orders(today)) ?? [];

  const fills =
    step("today's fills as Fubon answered", () => session.fills(today)) ?? [];

  const read = {
    orders: orders.flatMap((order) => fubonOrder(order, today) ?? []),
    fills: fills.flatMap((fill) => fubonFill(fill) ?? []),
  };

  show("orders as the app reads them", pretty(read.orders));
  show("fills as the app reads them", pretty(read.fills));

  if (holdings) {
    step("the account as the app reads it", () =>
      fubonAccount(holdings, read.orders, read.fills, today)
    );
  }
} finally {
  session.close();
}
