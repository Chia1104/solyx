import { expect, test } from "vite-plus/test";

import { InstrumentKind, Market } from "@solyx/core/market";
import type { Instrument } from "@solyx/core/market";
import { OrderType, Side } from "@solyx/core/order";
import type { OrderRequest } from "@solyx/core/order";

import { createPaperBroker } from "../src/paper.ts";

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
  const broker = createPaperBroker({ cash: { TWD: 2_000_000 } });
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
  const broker = createPaperBroker({ cash: { TWD: 100_000 } });

  await expect(broker.placeOrder(limit(Side.Buy, 1000, 980))).rejects.toThrow(
    "Insufficient TWD"
  );
});

test("cannot sell what it does not hold", async () => {
  const broker = createPaperBroker({ cash: { TWD: 100_000 } });

  await expect(broker.placeOrder(limit(Side.Sell, 1, 980))).rejects.toThrow(
    "Not enough shares"
  );
});

test("market orders need a price source", async () => {
  const broker = createPaperBroker({ cash: { TWD: 1_000_000 } });

  const order: OrderRequest = {
    instrument: tsmc,
    side: Side.Buy,
    quantity: 1000,
    type: OrderType.Market,
  };

  await expect(broker.placeOrder(order)).rejects.toThrow("no price source");
});
