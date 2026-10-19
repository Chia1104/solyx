import { describe, expect, test } from "vite-plus/test";

import { Market } from "../src/market.ts";
import type { SymbolRef } from "../src/market.ts";
import { OrderType, Side } from "../src/order.ts";
import type { AccountSnapshot, OrderRequest } from "../src/order.ts";
import {
  MAX_EXIT_DAYS,
  RiskViolationCode,
  checkExit,
  checkOrder,
  premiseViolations,
  sessionBand,
} from "../src/risk.ts";
import type { RiskContext, RiskLimits } from "../src/risk.ts";
import { Session, listedTradingDays } from "../src/session.ts";

const limits: RiskLimits = {
  maxOrderNotional: { TWD: 1_000_000, USD: 10_000 },
  allowedSessions: [Session.Regular],
};

const tsmc: SymbolRef = {
  market: Market.TW,
  symbol: "2330",
};

const open: RiskContext = {
  session: Session.Regular,
  markets: [Market.TW, Market.US],
  account: {
    cash: { TWD: 2_000_000, USD: 10_000 },
    positions: [{ instrument: tsmc, quantity: 1000, avgPrice: 900 }],
  },
};

const apple: SymbolRef = {
  market: Market.US,
  symbol: "AAPL",
};

function buyLimit(quantity: number, limitPrice: number): OrderRequest {
  return {
    instrument: tsmc,
    side: Side.Buy,
    quantity,
    type: OrderType.Limit,
    limitPrice,
  };
}

function codes(order: OrderRequest, context: RiskContext = open) {
  return checkOrder(order, limits, context).map((v) => v.code);
}

test("a sane TW limit order passes", () => {
  expect(codes(buyLimit(1000, 980))).toEqual([]);
});

test("price off the tick grid is rejected", () => {
  expect(codes(buyLimit(1, 580.3))).toEqual([RiskViolationCode.InvalidPrice]);
});

test("a fund's price is checked on a fund's grid, told by its code", () => {
  const price = (symbol: string, limitPrice: number): OrderRequest => ({
    ...buyLimit(1000, limitPrice),
    instrument: { market: Market.TW, symbol },
  });

  expect(codes(price("0050", 114.85))).toEqual([]);
  expect(codes(price("00679B", 27.33))).toEqual([]);
  expect(codes(price("0050", 114.83))).toEqual([
    RiskViolationCode.InvalidPrice,
  ]);
  // A stock at the same prices is off its grid.
  expect(codes(price("2317", 114.85))).toEqual([
    RiskViolationCode.InvalidPrice,
  ]);
  expect(codes(price("2317", 27.33))).toEqual([RiskViolationCode.InvalidPrice]);
});

test("mixed board/odd lot quantity is rejected", () => {
  expect(codes(buyLimit(1500, 500))).toEqual([
    RiskViolationCode.InvalidQuantity,
  ]);
});

test("odd lots cannot be market orders", () => {
  const order: OrderRequest = {
    instrument: tsmc,
    side: Side.Sell,
    quantity: 10,
    type: OrderType.Market,
  };

  expect(
    codes(order, { ...open, priceBand: { low: 882, high: 1070 } })
  ).toEqual([RiskViolationCode.OddLotMarketOrder]);
});

describe("a market order is sized at the session's limit-up", () => {
  const order: OrderRequest = {
    instrument: tsmc,
    side: Side.Buy,
    quantity: 1000,
    type: OrderType.Market,
  };

  test("which may put it over the cap a limit order at today's price stays under", () => {
    expect(
      codes(order, { ...open, priceBand: { low: 810, high: 990 } })
    ).toEqual([]);
    expect(
      checkOrder(order, limits, {
        ...open,
        priceBand: { low: 882, high: 1070 },
      })
    ).toEqual([
      {
        code: RiskViolationCode.OrderTooLarge,
        notional: 1_070_000,
        currency: "TWD",
        max: 1_000_000,
      },
    ]);
  });

  test("and cannot be sized where the listing has no limits or they are not known", () => {
    expect(codes(order, { ...open, priceBand: null })).toEqual([
      RiskViolationCode.MissingReferencePrice,
    ]);
    expect(codes(order)).toEqual([RiskViolationCode.MissingReferencePrice]);
  });
});

describe("the band of the session an order goes to", () => {
  // The limits set after Thursday 2026-10-08, with Friday a holiday.
  const trades = listedTradingDays("2026-10-01", [
    "2026-10-08",
    "2026-10-12",
    "2026-10-13",
  ]);

  const band = { low: 882, high: 1070 };
  const limits = { after: "2026-10-08", band };
  const at = (iso: string) => new Date(iso);

  test("holds them for the next day the market trades, until its close", () => {
    expect(
      sessionBand(limits, Market.TW, at("2026-10-08T15:00:00+08:00"), trades)
    ).toEqual(band);
    expect(
      sessionBand(limits, Market.TW, at("2026-10-12T13:29:00+08:00"), trades)
    ).toEqual(band);
  });

  test("knows none before they are set or after their session closes", () => {
    expect(
      sessionBand(limits, Market.TW, at("2026-10-08T10:00:00+08:00"), trades)
    ).toBeUndefined();
    expect(
      sessionBand(limits, Market.TW, at("2026-10-12T13:30:00+08:00"), trades)
    ).toBeUndefined();
    expect(
      sessionBand(null, Market.TW, at("2026-10-12T10:00:00+08:00"), trades)
    ).toBeUndefined();
  });

  test("tells a listing without limits from one whose limits are not known", () => {
    expect(
      sessionBand(
        { after: "2026-10-08", band: null },
        Market.TW,
        at("2026-10-12T10:00:00+08:00"),
        trades
      )
    ).toBeNull();
  });
});

test("limit price outside the daily limit band is rejected", () => {
  const context: RiskContext = {
    ...open,
    priceBand: { low: 882, high: 970 },
  };

  expect(codes(buyLimit(1000, 990), context)).toEqual([
    RiskViolationCode.OutsidePriceBand,
  ]);
});

test("every order is refused while the user has locked orders", () => {
  expect(codes(buyLimit(1000, 980), { ...open, locked: true })).toEqual([
    RiskViolationCode.OrdersLocked,
  ]);
});

test("once the day's loss reaches the user's limit, buys are refused and sales still go", () => {
  const reached = { ...open, dailyLoss: { realized: -50_000, max: 50_000 } };

  expect(checkOrder(buyLimit(1000, 980), limits, reached)).toEqual([
    {
      code: RiskViolationCode.DailyLossReached,
      loss: 50_000,
      max: 50_000,
      currency: "TWD",
    },
  ]);
  expect(codes({ ...buyLimit(1000, 980), side: Side.Sell }, reached)).toEqual(
    []
  );
  expect(
    codes(buyLimit(1000, 980), {
      ...open,
      dailyLoss: { realized: -49_999, max: 50_000 },
    })
  ).toEqual([]);
});

test("orders over the notional cap are rejected", () => {
  expect(codes(buyLimit(2000, 980))).toEqual([RiskViolationCode.OrderTooLarge]);
});

test("orders outside allowed sessions are rejected", () => {
  const order: OrderRequest = {
    instrument: apple,
    side: Side.Buy,
    quantity: 10,
    type: OrderType.Limit,
    limitPrice: 230.12,
  };

  expect(codes(order, { ...open, session: Session.Post })).toEqual([
    RiskViolationCode.SessionNotAllowed,
  ]);
});

test("a market the broker does not trade is rejected", () => {
  const order: OrderRequest = {
    instrument: apple,
    side: Side.Buy,
    quantity: 10,
    type: OrderType.Limit,
    limitPrice: 230.12,
  };

  expect(checkOrder(order, limits, { ...open, markets: [Market.TW] })).toEqual([
    { code: RiskViolationCode.UnsupportedMarket, market: Market.US },
  ]);
});

test("a buy past the account's cash is rejected", () => {
  const poorer: RiskContext = {
    ...open,
    account: { ...open.account, cash: { TWD: 500_000 } },
  };

  expect(checkOrder(buyLimit(1000, 980), limits, poorer)).toEqual([
    {
      code: RiskViolationCode.InsufficientCash,
      notional: 980_000,
      cash: 500_000,
      currency: "TWD",
    },
  ]);
});

test("a buy is rejected while the broker cannot say what the account can spend, and a sale still goes", () => {
  const unknown: RiskContext = {
    ...open,
    account: { ...open.account, cash: { TWD: null } },
  };

  expect(checkOrder(buyLimit(1000, 980), limits, unknown)).toEqual([
    { code: RiskViolationCode.CashUnknown, currency: "TWD" },
  ]);

  expect(
    checkOrder({ ...buyLimit(1000, 980), side: Side.Sell }, limits, unknown)
  ).toEqual([]);
});

test("a sale may draw only on the shares working sales leave", () => {
  const order: OrderRequest = {
    instrument: tsmc,
    side: Side.Sell,
    quantity: 1000,
    type: OrderType.Limit,
    limitPrice: 400,
  };

  const reserved: RiskContext = {
    ...open,
    account: {
      ...open.account,
      positions: [
        { instrument: tsmc, quantity: 1000, avgPrice: 900, sellable: 0 },
      ],
    },
  };

  expect(checkOrder(order, limits, reserved)).toEqual([
    { code: RiskViolationCode.InsufficientShares, quantity: 1000, held: 0 },
  ]);
});

test("a sale of more shares than the account holds is rejected", () => {
  const order: OrderRequest = {
    instrument: tsmc,
    side: Side.Sell,
    quantity: 2000,
    type: OrderType.Limit,
    limitPrice: 400,
  };

  expect(checkOrder(order, limits, open)).toEqual([
    { code: RiskViolationCode.InsufficientShares, quantity: 2000, held: 1000 },
  ]);
});

describe("a proposal's premise", () => {
  const then = {
    session: "2026-10-19",
    price: 1000,
    band: { low: 900, high: 1100 },
  };

  test("holds for its session while the price stays within the most it may move", () => {
    expect(
      premiseViolations(then, { session: "2026-10-19", price: 1030 })
    ).toEqual([]);
    expect(
      premiseViolations(then, { session: "2026-10-19", price: 1031 })
    ).toEqual([
      {
        code: RiskViolationCode.PriceMoved,
        proposedAt: 1000,
        price: 1031,
        max: 0.03,
      },
    ]);
    expect(
      premiseViolations(then, { session: "2026-10-19", price: 969 })
    ).toHaveLength(1);
  });

  test("is stale once its session is past, or where none was kept", () => {
    expect(
      premiseViolations(then, { session: "2026-10-20", price: 1000 })
    ).toEqual([
      {
        code: RiskViolationCode.PremiseStale,
        proposedFor: "2026-10-19",
        session: "2026-10-20",
      },
    ]);
    expect(
      premiseViolations(null, { session: "2026-10-20", price: 1000 })
    ).toEqual([
      {
        code: RiskViolationCode.PremiseStale,
        proposedFor: null,
        session: "2026-10-20",
      },
    ]);
  });

  test("takes a move of exactly the most it allows, which decimal prices only approximate", () => {
    const ten = { session: "2026-10-19", price: 10, band: null };

    expect(
      premiseViolations(ten, { session: "2026-10-19", price: 10.3 })
    ).toEqual([]);
    expect(
      premiseViolations(ten, { session: "2026-10-19", price: 9.7 })
    ).toEqual([]);
    expect(
      premiseViolations(ten, { session: "2026-10-19", price: 10.31 })
    ).toHaveLength(1);
  });

  test("leaves a price it cannot compare alone", () => {
    expect(
      premiseViolations(
        { ...then, price: null },
        { session: "2026-10-19", price: 2000 }
      )
    ).toEqual([]);
    expect(
      premiseViolations(then, { session: "2026-10-19", price: null })
    ).toEqual([]);
  });
});

describe("an exit", () => {
  const holding: AccountSnapshot = {
    cash: {},
    positions: [
      {
        instrument: { market: Market.TW, symbol: "2330" },
        quantity: 2000,
        avgPrice: 900,
        sellable: 1000,
      },
    ],
  };

  const context = {
    markets: [Market.TW],
    account: holding,
    watches: true,
    price: 1000,
    today: "2026-10-19",
    covered: 0,
  };

  const request = {
    instrument: { market: Market.TW, symbol: "2330" },
    quantity: 1000,
    stop: 950,
    target: 1100,
    until: "2026-11-18",
  };

  test("passes on shares the account can sell, prices on the tick either side of the last and a last day within reach", () => {
    expect(checkExit(request, context)).toEqual([]);
  });

  test("ends from tomorrow through MAX_EXIT_DAYS on", () => {
    const range = {
      code: RiskViolationCode.ExitUntilOutOfRange,
      first: "2026-10-20",
      last: "2026-12-18",
    };

    expect(checkExit({ ...request, until: "2026-10-19" }, context)).toEqual([
      range,
    ]);
    expect(checkExit({ ...request, until: "2026-12-18" }, context)).toEqual([]);
    expect(checkExit({ ...request, until: "2026-12-19" }, context)).toEqual([
      range,
    ]);
    expect(MAX_EXIT_DAYS).toBe(60);
  });

  test("sets a price, on the listing's tick, and sells no more than the working sales and other exits leave", () => {
    expect(
      checkExit(
        { ...request, quantity: 1500, stop: 950.5, target: null },
        { ...context, covered: 500 }
      )
    ).toEqual([
      { code: RiskViolationCode.InvalidQuantity, market: Market.TW },
      { code: RiskViolationCode.InvalidPrice, price: 950.5, tick: 1 },
      { code: RiskViolationCode.InsufficientShares, quantity: 1500, held: 500 },
    ]);
    expect(
      checkExit({ ...request, stop: null, target: null }, context)
    ).toEqual([{ code: RiskViolationCode.ExitWithoutPrice }]);
  });
});
