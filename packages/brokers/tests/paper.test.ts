import { describe, expect, test } from "vite-plus/test";

import { OrderRefusedError } from "@solyx/core/broker";
import { Market } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { OrderType, Side } from "@solyx/core/order";
import type { Fill, OrderRequest } from "@solyx/core/order";

import { createPaperBroker } from "../src/paper.ts";
import type {
  PaperAccount,
  PaperBrokerOptions,
  PaperLedger,
} from "../src/paper.ts";

// Copies on the way in and out, like a database would, so the broker cannot lean on shared objects.
function memoryLedger(): PaperLedger {
  let saved: PaperAccount | undefined;
  const fills: Fill[] = [];

  return {
    read: () => structuredClone(saved),
    write: (account, fill) => {
      saved = structuredClone(account);
      fills.push(structuredClone(fill));
    },
    fills: (since) =>
      structuredClone(fills.filter(({ filledAt }) => filledAt >= since)),
  };
}

const paper = (cash: PaperBrokerOptions["cash"], ledger = memoryLedger()) =>
  createPaperBroker({ cash, ledger });

const tsmc: SymbolRef = {
  market: Market.TW,
  symbol: "2330",
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

test("refuses to spend more cash than it has", async () => {
  const broker = paper({ TWD: 100_000 });
  const placing = broker.placeOrder(limit(Side.Buy, 1000, 980));

  await expect(placing).rejects.toThrow(OrderRefusedError);
  await expect(placing).rejects.toThrow("Insufficient TWD");
});

test("refuses to sell what it does not hold", async () => {
  const broker = paper({ TWD: 100_000 });
  const placing = broker.placeOrder(limit(Side.Sell, 1, 980));

  await expect(placing).rejects.toThrow(OrderRefusedError);
  await expect(placing).rejects.toThrow("Not enough shares");
});

describe("a market order", () => {
  const order: OrderRequest = {
    instrument: tsmc,
    side: Side.Buy,
    quantity: 1000,
    type: OrderType.Market,
  };

  test("fills at the price its source gives", async () => {
    const broker = createPaperBroker({
      cash: { TWD: 1_000_000 },
      ledger: memoryLedger(),
      getLastPrice: async () => 975,
    });

    await broker.placeOrder(order);

    expect(await broker.getAccount()).toEqual({
      cash: { TWD: 25_000 },
      positions: [{ instrument: tsmc, quantity: 1000, avgPrice: 975 }],
    });
  });

  test("is refused without a price source, or when it cannot price one", async () => {
    await expect(paper({ TWD: 1_000_000 }).placeOrder(order)).rejects.toThrow(
      OrderRefusedError
    );

    const unpriced = createPaperBroker({
      cash: { TWD: 1_000_000 },
      ledger: memoryLedger(),
      getLastPrice: () => Promise.reject(new Error("quotes are down")),
    });

    await expect(unpriced.placeOrder(order)).rejects.toThrow(
      "could not price the market order: quotes are down"
    );
  });
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

test("keeps each fill, a sale with what it gained over the average cost", async () => {
  const clock = { now: 1_000 };

  const broker = createPaperBroker({
    cash: { TWD: 2_000_000 },
    ledger: memoryLedger(),
    now: () => clock.now,
  });

  await broker.placeOrder(limit(Side.Buy, 1000, 900));
  clock.now = 2_000;
  await broker.placeOrder(limit(Side.Buy, 1000, 1000));
  clock.now = 3_000;
  await broker.placeOrder(limit(Side.Sell, 500, 920));

  expect(await broker.getFills(2_000)).toEqual([
    {
      orderId: "paper-2",
      instrument: tsmc,
      side: Side.Buy,
      quantity: 1000,
      price: 1000,
      filledAt: 2_000,
      realized: null,
    },
    {
      orderId: "paper-3",
      instrument: tsmc,
      side: Side.Sell,
      quantity: 500,
      price: 920,
      filledAt: 3_000,
      // Sold below the average cost of 950.
      realized: -15_000,
    },
  ]);
});
