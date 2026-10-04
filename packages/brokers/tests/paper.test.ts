import { expect, test } from "vite-plus/test";

import { InstrumentKind, Market } from "@solyx/core/market";
import type { Instrument } from "@solyx/core/market";
import { OrderType, Side } from "@solyx/core/order";
import type { OrderRequest } from "@solyx/core/order";

import { createPaperBroker } from "../src/paper.ts";
import type {
  PaperAccount,
  PaperBrokerOptions,
  PaperLedger,
} from "../src/paper.ts";

// Copies on the way in and out, like a database would, so the broker cannot lean on shared objects.
function memoryLedger(): PaperLedger {
  let saved: PaperAccount | undefined;

  return {
    read: () => structuredClone(saved),
    write: (account) => {
      saved = structuredClone(account);
    },
  };
}

const paper = (cash: PaperBrokerOptions["cash"], ledger = memoryLedger()) =>
  createPaperBroker({ cash, ledger });

const tsmc: Instrument = {
  market: Market.TW,
  symbol: "2330",
  kind: InstrumentKind.Stock,
};

function limit(side: Side, quantity: number, limitPrice: number): OrderRequest {
  return {
    instrument: tsmc,
    side,
    quantity,
    type: OrderType.Limit,
    limitPrice,
  };
}

test("buys and sells move cash and positions", async () => {
  const broker = paper({ TWD: 2_000_000 });
  await broker.placeOrder(limit(Side.Buy, 1000, 900));
  await broker.placeOrder(limit(Side.Buy, 1000, 1000));
  await broker.placeOrder(limit(Side.Sell, 500, 1100));
  const account = await broker.getAccount();

  expect(account.cash.TWD).toBe(2_000_000 - 900_000 - 1_000_000 + 550_000);
  expect(account.positions).toEqual([
    { instrument: tsmc, quantity: 1500, avgPrice: 950 },
  ]);
});

test("cannot spend more cash than it has", async () => {
  const broker = paper({ TWD: 100_000 });

  await expect(broker.placeOrder(limit(Side.Buy, 1000, 980))).rejects.toThrow(
    "Insufficient TWD"
  );
});

test("cannot sell what it does not hold", async () => {
  const broker = paper({ TWD: 100_000 });

  await expect(broker.placeOrder(limit(Side.Sell, 1, 980))).rejects.toThrow(
    "Not enough shares"
  );
});

test("market orders need a price source", async () => {
  const broker = paper({ TWD: 1_000_000 });

  const order: OrderRequest = {
    instrument: tsmc,
    side: Side.Buy,
    quantity: 1000,
    type: OrderType.Market,
  };

  await expect(broker.placeOrder(order)).rejects.toThrow("no price source");
});

test("the account outlives the broker, and order ids keep counting", async () => {
  const ledger = memoryLedger();
  const first = paper({ TWD: 2_000_000 }, ledger);

  expect(await first.placeOrder(limit(Side.Buy, 1000, 900))).toEqual({
    orderId: "paper-1",
  });

  const reopened = paper({ TWD: 2_000_000 }, ledger);

  expect(await reopened.getAccount()).toEqual(await first.getAccount());
  expect(await reopened.placeOrder(limit(Side.Sell, 1000, 950))).toEqual({
    orderId: "paper-2",
  });
  expect(await reopened.getAccount()).toEqual({
    cash: { TWD: 2_000_000 - 900_000 + 950_000 },
    positions: [],
  });
});

test("a refused order leaves the account as it was", async () => {
  const ledger = memoryLedger();
  const broker = paper({ TWD: 100_000 }, ledger);

  await expect(broker.placeOrder(limit(Side.Buy, 1000, 980))).rejects.toThrow();
  expect(ledger.read()).toBeUndefined();
});
