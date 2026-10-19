import { describe, expect, test } from "vite-plus/test";

import { BrokerOrderStatus, OrderRefusedError } from "@solyx/core/broker";
import { Market } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { ExitLeg, OrderType, Side } from "@solyx/core/order";
import type { OrderRequest } from "@solyx/core/order";

import { createPaperBroker } from "../src/paper.ts";
import type {
  PaperAccount,
  PaperBrokerOptions,
  PaperExitLeg,
  PaperFill,
  PaperLedger,
} from "../src/paper.ts";

// Copies on the way in and out, like a database would, so the broker cannot lean on shared objects.
function memoryLedger(): PaperLedger {
  let saved: PaperAccount | undefined;
  const fills: PaperFill[] = [];
  let legs: PaperExitLeg[] = [];

  const drop = (refs: readonly string[]) => {
    legs = legs.filter(({ ref }) => !refs.includes(ref));
  };

  return {
    read: () => structuredClone(saved),
    write: (account, fill, ended = []) => {
      saved = structuredClone(account);
      fills.push(structuredClone(fill));
      drop(ended);
    },
    fills: (since) =>
      structuredClone(fills.filter(({ filledAt }) => filledAt >= since)),
    exitLegs: () => structuredClone(legs),
    addExitLegs: (added) => {
      legs.push(...structuredClone(added));
    },
    removeExitLegs: drop,
  };
}

const paper = (cash: PaperBrokerOptions["cash"], ledger = memoryLedger()) =>
  createPaperBroker({ cash, ledger });

const TAG = "A1B2C3";

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
  await broker.placeOrder(limit(Side.Buy, 1000, 900), TAG);
  await broker.placeOrder(limit(Side.Buy, 1000, 1000), TAG);
  await broker.placeOrder(limit(Side.Sell, 500, 1100), TAG);
  const account = await broker.getAccount();

  expect(account.cash.TWD).toBe(2_000_000 - 900_000 - 1_000_000 + 550_000);
  expect(account.positions).toEqual([
    { instrument: tsmc, quantity: 1500, avgPrice: 950 },
  ]);
});

test("refuses to spend more cash than it has", async () => {
  const broker = paper({ TWD: 100_000 });
  const placing = broker.placeOrder(limit(Side.Buy, 1000, 980), TAG);

  await expect(placing).rejects.toThrow(OrderRefusedError);
  await expect(placing).rejects.toThrow("Insufficient TWD");
});

test("refuses to sell what it does not hold", async () => {
  const broker = paper({ TWD: 100_000 });
  const placing = broker.placeOrder(limit(Side.Sell, 1, 980), TAG);

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

    await broker.placeOrder(order, TAG);

    expect(await broker.getAccount()).toEqual({
      cash: { TWD: 25_000 },
      positions: [{ instrument: tsmc, quantity: 1000, avgPrice: 975 }],
    });
  });

  test("is refused without a price source, or when it cannot price one", async () => {
    await expect(
      paper({ TWD: 1_000_000 }).placeOrder(order, TAG)
    ).rejects.toThrow(OrderRefusedError);

    const unpriced = createPaperBroker({
      cash: { TWD: 1_000_000 },
      ledger: memoryLedger(),
      getLastPrice: () => Promise.reject(new Error("quotes are down")),
    });

    await expect(unpriced.placeOrder(order, TAG)).rejects.toThrow(
      "could not price the market order: quotes are down"
    );
  });
});

test("the account outlives the broker, and order ids keep counting", async () => {
  const ledger = memoryLedger();
  const first = paper({ TWD: 2_000_000 }, ledger);

  expect(await first.placeOrder(limit(Side.Buy, 1000, 900), TAG)).toEqual({
    orderId: "paper-1",
  });

  const reopened = paper({ TWD: 2_000_000 }, ledger);

  expect(await reopened.getAccount()).toEqual(await first.getAccount());
  expect(await reopened.placeOrder(limit(Side.Sell, 1000, 950), TAG)).toEqual({
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

  await expect(
    broker.placeOrder(limit(Side.Buy, 1000, 980), TAG)
  ).rejects.toThrow();
  expect(ledger.read()).toBeUndefined();
});

test("keeps each fill, a sale with what it gained over the average cost", async () => {
  const clock = { now: 1_000 };

  const broker = createPaperBroker({
    cash: { TWD: 2_000_000 },
    ledger: memoryLedger(),
    now: () => clock.now,
  });

  await broker.placeOrder(limit(Side.Buy, 1000, 900), TAG);
  clock.now = 2_000;
  await broker.placeOrder(limit(Side.Buy, 1000, 1000), TAG);
  clock.now = 3_000;
  await broker.placeOrder(limit(Side.Sell, 500, 920), TAG);

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

test("lists each order it filled, whole, with the tag it was placed with", async () => {
  const broker = createPaperBroker({
    cash: { TWD: 2_000_000 },
    ledger: memoryLedger(),
    getLastPrice: async () => 950,
    now: () => 1_000,
  });

  const market: OrderRequest = {
    instrument: tsmc,
    side: Side.Buy,
    quantity: 1000,
    type: OrderType.Market,
  };

  await broker.placeOrder(limit(Side.Buy, 1000, 900), "LIMIT1");
  await broker.placeOrder(market, "MARKET");

  expect(await broker.getOrders(0)).toEqual([
    {
      id: "paper-1",
      tag: "LIMIT1",
      order: limit(Side.Buy, 1000, 900),
      filled: 1000,
      status: BrokerOrderStatus.Filled,
      placedAt: 1_000,
    },
    {
      id: "paper-2",
      tag: "MARKET",
      order: market,
      filled: 1000,
      status: BrokerOrderStatus.Filled,
      placedAt: 1_000,
    },
  ]);
});

describe("exits", () => {
  // 10:00 in Taipei on 2026-10-19.
  const NOW = Date.UTC(2026, 9, 19, 2);

  async function holding(price: { last: number }) {
    const ledger = memoryLedger();

    const broker = createPaperBroker({
      cash: { TWD: 1_000_000 },
      ledger,
      getLastPrice: async () => price.last,
      now: () => NOW,
    });

    await broker.placeOrder(limit(Side.Buy, 1000, 600), "BUY001");

    if (!broker.exits) throw new Error("The paper account watches exits");

    return { broker, exits: broker.exits, ledger };
  }

  const exit = { stop: 550, target: 700, until: "2026-11-18" };

  test("watches each leg until the price reaches one, which sells the exit whole at that price and ends the other", async () => {
    const price = { last: 600 };
    const { broker, exits } = await holding(price);

    const refs = await exits.place(tsmc, 1000, exit, TAG);

    expect(refs).toEqual([`${TAG}:stop`, `${TAG}:target`]);
    expect(await exits.watching()).toEqual([
      {
        ref: `${TAG}:stop`,
        instrument: tsmc,
        quantity: 1000,
        leg: ExitLeg.Stop,
        price: 550,
        placedAt: NOW,
      },
      {
        ref: `${TAG}:target`,
        instrument: tsmc,
        quantity: 1000,
        leg: ExitLeg.Target,
        price: 700,
        placedAt: NOW,
      },
    ]);

    price.last = 548;

    expect(await exits.watching()).toEqual([]);
    expect((await broker.getAccount()).positions).toEqual([]);
    expect((await broker.getOrders(0)).at(-1)).toMatchObject({
      tag: TAG,
      order: { side: Side.Sell, quantity: 1000, type: OrderType.Market },
    });
    expect((await broker.getFills(0)).at(-1)).toMatchObject({
      price: 548,
      realized: -52_000,
    });
  });

  test("a target reached sells too", async () => {
    const price = { last: 600 };
    const { broker, exits } = await holding(price);

    await exits.place(tsmc, 1000, { ...exit, stop: null }, TAG);
    price.last = 705;

    expect(await exits.watching()).toEqual([]);
    expect((await broker.getFills(0)).at(-1)).toMatchObject({ price: 705 });
  });

  test("one whose last day has passed ends unsold", async () => {
    const { broker, exits } = await holding({ last: 600 });

    await exits.place(tsmc, 1000, { ...exit, until: "2026-10-18" }, TAG);

    expect(await exits.watching()).toEqual([]);
    expect((await broker.getAccount()).positions).toHaveLength(1);
  });

  test("one whose shares were sold meanwhile ends unsold", async () => {
    const price = { last: 600 };
    const { broker, exits } = await holding(price);

    await exits.place(tsmc, 1000, exit, TAG);
    await broker.placeOrder(limit(Side.Sell, 1000, 600), "SELL01");
    price.last = 540;

    expect(await exits.watching()).toEqual([]);
    expect(await broker.getFills(0)).toHaveLength(2);
  });

  test("a cancelled leg is no longer watched, and one it does not watch cannot be cancelled", async () => {
    const { exits } = await holding({ last: 600 });

    await exits.place(tsmc, 1000, exit, TAG);
    await exits.cancel(`${TAG}:stop`);

    expect((await exits.watching()).map(({ ref }) => ref)).toEqual([
      `${TAG}:target`,
    ]);
    await expect(exits.cancel(`${TAG}:stop`)).rejects.toThrow(
      "watches no exit leg"
    );
  });
});
